import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchableSelect } from "../../src/components/searchable-select";

describe("searchable controlled hospital choices", () => {
  const options = [{ value: "bed-a", label: "Demo G-104 · General" }, { value: "bed-b", label: "Demo P-201 · Private" }];
  it("submits a configured ID through a required native select, never search text", () => {
    const html = renderToStaticMarkup(createElement(SearchableSelect, { name: "bedId", label: "Bed assignment", options, required: true, value: "bed-b" }));
    expect(html).toMatch(/<select[^>]*name="bedId"[^>]*required=""/);
    expect(html).toContain('<option value="bed-b" selected="">Demo P-201 · Private</option>');
    expect(html).toMatch(/<input[^>]*type="search"/);
    expect(html).not.toMatch(/<input[^>]*name=/);
  });
  it("does not present a removed destination as a valid selected bed", () => {
    const html = renderToStaticMarkup(createElement(SearchableSelect, { name: "bedId", label: "Bed assignment", options, required: true, value: "removed-bed" }));
    expect(html).toContain('<option value="" selected="">Choose an option</option>');
    expect(html).not.toContain('value="removed-bed"');
  });
  it("explains an empty configured list without inventing options", () => {
    const html = renderToStaticMarkup(createElement(SearchableSelect, { name: "bedId", label: "Bed assignment", options: [], required: true }));
    expect(html).toContain("No options available.");
    expect(html).toMatch(/<select[^>]*disabled=""/);
  });
});
