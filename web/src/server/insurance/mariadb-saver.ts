import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  TASKS,
  WRITES_IDX_MAP,
  maxChannelVersion,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
} from "@langchain/langgraph-checkpoint";
import type { Pool, RowDataPacket } from "mysql2/promise";

type Bytes = Uint8Array;
type CheckpointRow = {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint: Checkpoint & { v: number; channel_versions: Record<string, string | number> };
  metadata: CheckpointMetadata;
  channel_values: [Bytes, Bytes, Bytes][];
  pending_writes: [Bytes, Bytes, Bytes, Bytes][];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const asBytes = (value: unknown): Bytes => (value instanceof Uint8Array ? new Uint8Array(value) : encoder.encode(String(value ?? "")));
const parseJson = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : (value as T));

/**
 * LangGraph checkpointer over MariaDB (tables lg_checkpoints, lg_checkpoint_blobs, lg_checkpoint_writes,
 * lg_checkpoint_migrations), mirroring PostgresSaver's behaviour: checkpoints are keyed by (thread, namespace, id),
 * channel values are stored once per version in the blob table, and pending writes are kept per task.
 */
export class MariaDbSaver extends BaseCheckpointSaver {
  constructor(private readonly pool: Pool, serde?: SerializerProtocol) {
    super(serde);
  }

  private async selectRows(where: string, args: unknown[]): Promise<CheckpointRow[]> {
    const [found] = await this.pool.query<RowDataPacket[]>(
      `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata FROM lg_checkpoints ${where}`,
      args,
    );
    const rows: CheckpointRow[] = [];
    for (const row of found) {
      const checkpoint = parseJson<CheckpointRow["checkpoint"]>(row.checkpoint);
      const versions = Object.entries(checkpoint.channel_versions ?? {});
      let blobs: RowDataPacket[] = [];
      if (versions.length) {
        [blobs] = await this.pool.query<RowDataPacket[]>(
          `SELECT channel, type, \`blob\` FROM lg_checkpoint_blobs WHERE thread_id = ? AND checkpoint_ns = ? AND (${versions.map(() => "(channel = ? AND version = ?)").join(" OR ")})`,
          [row.thread_id, row.checkpoint_ns, ...versions.flatMap(([channel, version]) => [channel, String(version)])],
        );
      }
      const [writes] = await this.pool.query<RowDataPacket[]>(
        "SELECT task_id, channel, type, `blob` FROM lg_checkpoint_writes WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? ORDER BY task_id, idx",
        [row.thread_id, row.checkpoint_ns, row.checkpoint_id],
      );
      rows.push({
        thread_id: row.thread_id,
        checkpoint_ns: row.checkpoint_ns,
        checkpoint_id: row.checkpoint_id,
        parent_checkpoint_id: row.parent_checkpoint_id ?? null,
        checkpoint,
        metadata: parseJson<CheckpointMetadata>(row.metadata),
        channel_values: blobs.map((b) => [encoder.encode(b.channel), encoder.encode(b.type), asBytes(b.blob)] as [Bytes, Bytes, Bytes]),
        pending_writes: writes.map((w) => [encoder.encode(w.task_id), encoder.encode(w.channel), encoder.encode(w.type ?? ""), asBytes(w.blob)] as [Bytes, Bytes, Bytes, Bytes]),
      });
    }
    // Checkpoints written before langgraph checkpoint format 4 keep their sends on the parent's writes.
    for (const row of rows.filter((r) => r.checkpoint.v < 4 && r.parent_checkpoint_id != null)) {
      const [sends] = await this.pool.query<RowDataPacket[]>(
        "SELECT type, `blob` FROM lg_checkpoint_writes WHERE thread_id = ? AND checkpoint_id = ? AND channel = ? ORDER BY task_id, idx",
        [row.thread_id, row.parent_checkpoint_id, TASKS],
      );
      if (sends.length) await this.migratePendingSends(sends, row);
    }
    return rows;
  }

  private async migratePendingSends(sends: RowDataPacket[], row: CheckpointRow) {
    const values = await Promise.all(sends.map((s) => this.serde.loadsTyped(String(s.type), asBytes(s.blob))));
    const [type, blob] = await this.serde.dumpsTyped(values);
    row.channel_values.push([encoder.encode(TASKS), encoder.encode(type), blob]);
    const current = Object.values(row.checkpoint.channel_versions);
    row.checkpoint.channel_versions[TASKS] = current.length ? maxChannelVersion(...(current as never[])) : this.getNextVersion(undefined);
  }

  private async tupleOf(row: CheckpointRow): Promise<CheckpointTuple> {
    const entries = await Promise.all(
      row.channel_values
        .filter(([, type]) => decoder.decode(type) !== "empty")
        .map(async ([channel, type, blob]) => [decoder.decode(channel), await this.serde.loadsTyped(decoder.decode(type), blob)] as const),
    );
    const [metadataType, metadataBytes] = await this.serde.dumpsTyped(row.metadata);
    const config = (id: string): RunnableConfig => ({ configurable: { thread_id: row.thread_id, checkpoint_ns: row.checkpoint_ns, checkpoint_id: id } });
    return {
      config: config(row.checkpoint_id),
      checkpoint: { ...row.checkpoint, channel_versions: row.checkpoint.channel_versions ?? {}, versions_seen: row.checkpoint.versions_seen ?? {}, channel_values: Object.fromEntries(entries) } as Checkpoint,
      metadata: (await this.serde.loadsTyped(metadataType, metadataBytes)) as CheckpointMetadata,
      parentConfig: row.parent_checkpoint_id ? config(row.parent_checkpoint_id) : undefined,
      pendingWrites: await Promise.all(
        row.pending_writes.map(async ([task, channel, type, blob]) => [decoder.decode(task), decoder.decode(channel), await this.serde.loadsTyped(decoder.decode(type), blob)] as [string, string, unknown]),
      ),
    };
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { thread_id, checkpoint_ns = "", checkpoint_id } = config.configurable ?? {};
    const [row] = checkpoint_id
      ? await this.selectRows("WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?", [thread_id, checkpoint_ns, checkpoint_id])
      : await this.selectRows("WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY checkpoint_id DESC LIMIT 1", [thread_id, checkpoint_ns]);
    return row ? this.tupleOf(row) : undefined;
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const { filter, before, limit } = options ?? {};
    const wheres: string[] = [];
    const args: unknown[] = [];
    if (config?.configurable?.thread_id) { wheres.push("thread_id = ?"); args.push(config.configurable.thread_id); }
    if (config?.configurable?.checkpoint_ns !== undefined && config?.configurable?.checkpoint_ns !== null) { wheres.push("checkpoint_ns = ?"); args.push(config.configurable.checkpoint_ns); }
    if (config?.configurable?.checkpoint_id) { wheres.push("checkpoint_id = ?"); args.push(config.configurable.checkpoint_id); }
    if (filter && Object.keys(filter).length) { wheres.push("JSON_CONTAINS(metadata, ?)"); args.push(JSON.stringify(filter)); }
    if (before?.configurable?.checkpoint_id !== undefined) { wheres.push("checkpoint_id < ?"); args.push(before.configurable.checkpoint_id); }
    const where = `${wheres.length ? `WHERE ${wheres.join(" AND ")}` : ""} ORDER BY checkpoint_id DESC${limit !== undefined ? ` LIMIT ${Number.parseInt(limit.toString(), 10)}` : ""}`;
    for (const row of await this.selectRows(where, args)) yield await this.tupleOf(row);
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata, newVersions: ChannelVersions): Promise<RunnableConfig> {
    if (config.configurable === undefined) throw new Error('Missing "configurable" field in "config" param');
    const { thread_id, checkpoint_ns = "", checkpoint_id } = config.configurable;
    const { channel_values: values, ...serialized } = checkpoint as Checkpoint & { channel_values: Record<string, unknown> };
    const blobs = await Promise.all(
      Object.entries(newVersions).map(async ([channel, version]) => {
        const [type, value] = channel in values ? await this.serde.dumpsTyped(values[channel]) : ["empty", null];
        return [thread_id, checkpoint_ns, channel, String(version), type, value ? Buffer.from(value) : null] as const;
      }),
    );
    const [, metadataBytes] = await this.serde.dumpsTyped(metadata);
    const serializedMetadata = JSON.parse(decoder.decode(metadataBytes).replace(/\0/g, ""));
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const blob of blobs) {
        await connection.query(
          "INSERT INTO lg_checkpoint_blobs (thread_id, checkpoint_ns, channel, version, type, `blob`) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE thread_id = thread_id",
          [...blob],
        );
      }
      await connection.query(
        "INSERT INTO lg_checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE checkpoint = VALUES(checkpoint), metadata = VALUES(metadata)",
        [thread_id, checkpoint_ns, checkpoint.id, checkpoint_id ?? null, JSON.stringify(serialized), JSON.stringify(serializedMetadata)],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return { configurable: { thread_id, checkpoint_ns, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const overwrite = writes.every((write) => write[0] in WRITES_IDX_MAP);
    const sql = `INSERT INTO lg_checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, \`blob\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE ${overwrite ? "channel = VALUES(channel), type = VALUES(type), `blob` = VALUES(`blob`)" : "thread_id = thread_id"}`;
    const { thread_id, checkpoint_ns = "", checkpoint_id } = config.configurable ?? {};
    const dumped = await Promise.all(
      writes.map(async ([channel, value], idx) => {
        const [type, bytes] = await this.serde.dumpsTyped(value);
        return [thread_id, checkpoint_ns, checkpoint_id, taskId, WRITES_IDX_MAP[channel] ?? idx, channel, type, Buffer.from(bytes)];
      }),
    );
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const write of dumped) await connection.query(sql, write);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const table of ["lg_checkpoint_blobs", "lg_checkpoints", "lg_checkpoint_writes"]) await connection.query(`DELETE FROM ${table} WHERE thread_id = ?`, [threadId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
