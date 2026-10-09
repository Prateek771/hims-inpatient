import "server-only";
import { Fragment } from "react";
import { Document, Page, Text, View, Image, Font, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import bwipjs from "bwip-js/node";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DomainError } from "../contracts";
import { documentSections } from "./model";
import { documentLimits, assertDocumentSourceSize, documentFontFamily as family, documentTextParts as parts } from "./content";
import type { DischargeSnapshot } from "./snapshot";
export function documentProjectDirectory() {
  const root = existsSync(resolve(process.cwd(), "web/package.json")) ? process.cwd() : resolve(process.cwd(), "..");
  if (!existsSync(resolve(root, "web/package.json"))) throw new DomainError("PRECONDITION", "Document assets require the INS project folder");
  return root;
}
let initialized = false;
async function fonts() {
  if (!initialized) {
    Font.register({ family: "DocumentSans", src: resolve(documentProjectDirectory(), "web/public/document-fonts/NotoSans-Regular.ttf") });
    Font.register({ family: "DocumentDevanagari", src: resolve(documentProjectDirectory(), "web/public/document-fonts/Mukta-Regular.ttf") });
    // These bounded ASCII identifiers fit full prose/header/footer widths.
    // Preserve their literal punctuation; narrow rows use measured callbacks.
    const identifier = /^[([]?(?:[a-f0-9]{64}|(?:UHID-)?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})[)\]]?[.,;:]?$/iu;
    Font.registerHyphenationCallback(word => word.length <= 36 || identifier.test(word) ? [word] : word.match(/.{1,36}/gu) ?? [word]);
    initialized = true;
  }
  await Promise.all([Font.load({ fontFamily: "DocumentSans" }), Font.load({ fontFamily: "DocumentDevanagari" })]);
}
function Words({ value }: { value: string }) { return <>{parts(value).map((v, i) => <Text key={i} style={{ fontFamily: family(v) }}>{v}</Text>)}</>; }
export async function verificationQR(url: string) { return Buffer.from(await bwipjs.toBuffer({ bcid: "qrcode", text: url, scale: 3, padding: 2 })); }
const style = StyleSheet.create({
  page: { fontFamily: "DocumentSans", fontSize: 9, color: "#122c3a", paddingTop: 66, paddingBottom: 112, paddingHorizontal: 38, lineHeight: 1.45 },
  header: { position: "absolute", top: 22, left: 38, right: 38, borderBottomWidth: 1, borderBottomColor: "#dce6ea", paddingBottom: 8, fontSize: 9 },
  title: { fontSize: 18, color: "#087f82", marginBottom: 12 }, section: { fontSize: 12, marginTop: 14, marginBottom: 7, color: "#087f82" },
  paragraph: { marginBottom: 6 }, row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#dce6ea", paddingVertical: 7, backgroundColor: "#f3f7f8" },
  label: { width: "70%", paddingHorizontal: 7 }, value: { width: "30%", paddingHorizontal: 7 },
  footer: { position: "absolute", bottom: 22, left: 38, right: 38, height: 74, borderTopWidth: 1, borderTopColor: "#dce6ea", fontSize: 7, color: "#546d7b" },
  qr: { position: "absolute", left: 0, top: 8, width: 65, height: 65 }, footerText: { position: "absolute", left: 77, top: 8, width: 390, height: 50 },
  footerLine: { fontSize: 7, lineHeight: 1.2 }, pageNumber: { position: "absolute", left: 115, right: 38, top: 807, fontSize: 7, lineHeight: 1.2 },
});
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
function columnHyphenation(width: number) {
  const cache = new Map<string, string[]>();
  return (word: string) => {
    const cached = cache.get(word); if (cached) return cached;
    const advance = (value: string) => parts(value).reduce((total, part) => {
      const font = Font.getFont({ fontFamily: family(part) }).data!;
      return total + font.layout(part).advanceWidth * 9 / font.unitsPerEm;
    }, 0);
    // Include the inserted line-end hyphen in the available 9pt text width.
    const hyphen = Math.max(...["DocumentSans", "DocumentDevanagari"].map(fontFamily => {
      const font = Font.getFont({ fontFamily }).data!; return font.layout("-").advanceWidth * 9 / font.unitsPerEm;
    }));
    const fits = (value: string) => advance(value) + hyphen <= width - 1;
    if (fits(word)) { if (cache.size >= 256) cache.clear(); cache.set(word, [word]); return [word]; }
    const chunks: string[] = []; let chunk = "";
    for (const { segment } of graphemes.segment(word)) {
      if (!fits(segment)) throw new DomainError("PRECONDITION", "A source grapheme exceeds the printable column width; content is retained without truncation");
      if (chunk && !fits(chunk + segment)) { chunks.push(chunk); chunk = segment; } else chunk += segment;
    }
    if (chunk) chunks.push(chunk);
    if (cache.size >= 256) cache.clear(); cache.set(word, chunks);
    return chunks;
  };
}
// A4 width minus both page margins, each column share, then both 7pt cell pads.
const labelHyphenation = columnHyphenation((595.28 - 76) * 0.7 - 14);
const valueHyphenation = columnHyphenation((595.28 - 76) * 0.3 - 14);
/** Only local fonts and generated QR bytes; no network or separately refreshed source query. */
export async function renderDischargePDF(snapshot: DischargeSnapshot, hash: string) {
  assertDocumentSourceSize(snapshot);
  await fonts();
  const sections = documentSections(snapshot);
  const printable = ["Final discharge copy", snapshot.documentId, hash, ...sections.flatMap(s => [s.title, ...s.paragraphs, ...s.rows.flat()])].join("\n");
  if (printable.length > documentLimits.printableCharacters || sections.some(s => s.rows.some(r => r.join("").length > documentLimits.rowCharacters))) throw new DomainError("PRECONDITION", "Printable content exceeds 500000 characters or a row exceeds 1600 characters; source records are retained without truncation");
  for (const part of parts(printable)) {
    const font = Font.getFont({ fontFamily: family(part) }).data;
    for (const ch of part) if (!/[\n\r\t\u200c\u200d]/u.test(ch) && !font?.hasGlyphForCodePoint(ch.codePointAt(0)!)) throw new DomainError("PRECONDITION", `Portable document fonts do not support character U+${ch.codePointAt(0)!.toString(16).toUpperCase()}; preserve the source and supply an appropriate licensed font`);
  }
  const qr = await verificationQR(snapshot.verificationUrl);
  const hospital = String(snapshot.hospital?.payload.name ?? "Hospital identity not configured");
  // Very large flex trees can overflow Yoga's numeric layout. Bound each table tree;
  // React PDF still wraps actual text/rows and counts every resulting A4 page.
  const pages = sections[2].rows.length <= 80 ? [sections] : [sections.slice(0, 2), ...Array.from({ length: Math.ceil(sections[2].rows.length / 15) }, (_, i) => [{ ...sections[2], title: i ? `${sections[2].title} (continued)` : sections[2].title, paragraphs: i ? [] : sections[2].paragraphs, rows: sections[2].rows.slice(i * 15, (i + 1) * 15) }]), sections.slice(3)];
  const bytes = await renderToBuffer(<Document title={`Final discharge copy - ${snapshot.admission.ipCode} - Revision ${snapshot.version}`} author={hospital} language="en-IN">
    {pages.map((sectionsOnPage, i) => <Page key={i} size="A4" style={style.page} wrap>
      <View fixed style={style.header}><Text><Words value={`${hospital} · ${snapshot.admission.ipCode} · Revision ${snapshot.version}`} /></Text></View>
      {i === 0 && <Text style={style.title}>Final discharge copy</Text>}
      {sectionsOnPage.map(section => <Fragment key={section.title}>
        <Text style={style.section} minPresenceAhead={22}><Words value={section.title} /></Text>
        {section.paragraphs.map((p, i) => <Text key={i} style={style.paragraph} orphans={2} widows={2}><Words value={p} /></Text>)}
        {section.rows.map(([label, value], i) => <View key={i} style={style.row}><Text style={style.label} hyphenationCallback={labelHyphenation}><Words value={label} /></Text><Text style={style.value} hyphenationCallback={valueHyphenation}><Words value={value} /></Text></View>)}
      </Fragment>)}
      <View fixed style={style.footer}>{/* React PDF Image has no HTML alt attribute. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={qr} style={style.qr} /><View style={style.footerText}>
        <Text style={style.footerLine}>Document verification - authenticated staff access</Text><Text style={style.footerLine}>{snapshot.admission.ipCode} · Revision {snapshot.version} · {snapshot.documentId}</Text>
        <Text style={style.footerLine}>Canonical snapshot SHA-256: {hash}</Text><Text style={style.footerLine}>Historical records and later amendments remain attributable.</Text>
      </View></View><Text fixed style={style.pageNumber} render={({ pageNumber, totalPages }) => {
          if (totalPages > documentLimits.pages) throw new DomainError("PRECONDITION", `Complete PDF exceeds 200 pages (${totalPages}); source records are retained without truncation`);
          return `Page ${pageNumber} of ${totalPages}`;
        }} />
    </Page>)}
  </Document>);
  if (bytes.length > documentLimits.bytes || !bytes.subarray(0,5).equals(Buffer.from("%PDF-")) || !bytes.subarray(-1024).includes(Buffer.from("%%EOF"))) throw new DomainError("PRECONDITION", "Generated PDF exceeds limits or is incomplete; publication was refused");
  return bytes;
}
