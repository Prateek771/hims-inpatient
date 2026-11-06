import { describe, expect, it } from "vitest";
import { splitStatements } from "../../scripts/sql-statements";

describe("splitStatements", () => {
  it("splits plain statements and drops comments", () => {
    expect(splitStatements("-- header\nCREATE TABLE a (x INT); /* note */ INSERT INTO a VALUES (1);\n# tail\n")).toEqual([
      "CREATE TABLE a (x INT)",
      "INSERT INTO a VALUES (1)",
    ]);
  });

  it("ignores delimiters inside quotes and identifiers", () => {
    expect(splitStatements("INSERT INTO a VALUES ('x;y', \"p;q\", `r;s`);")).toEqual(["INSERT INTO a VALUES ('x;y', \"p;q\", `r;s`)"]);
    expect(splitStatements("SELECT 'it\\'s; fine';")).toEqual(["SELECT 'it\\'s; fine'"]);
  });

  it("honours DELIMITER blocks with semicolons inside bodies", () => {
    const script = "CREATE TABLE a (x INT);\nDELIMITER $$\nDROP TRIGGER IF EXISTS t$$\nCREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW BEGIN SET NEW.x = 1; END$$\nDELIMITER ;\nSELECT 1;\n";
    expect(splitStatements(script)).toEqual([
      "CREATE TABLE a (x INT)",
      "DROP TRIGGER IF EXISTS t",
      "CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW BEGIN SET NEW.x = 1; END",
      "SELECT 1",
    ]);
  });

  it("rejects an unterminated block comment", () => {
    expect(() => splitStatements("SELECT 1; /* open")).toThrow("Unterminated comment");
  });
});
