import { assertEquals } from "@std/assert";
import { parseGrobidTei } from "../src/application/grobid.ts";

Deno.test("GROBID TEI becomes reviewable metadata candidates", () => {
  const suggestions = parseGrobidTei(`
    <TEI><teiHeader><fileDesc><titleStmt>
      <title>A Practical Paper</title><author><forename>Ada</forename><surname>Lovelace</surname></author>
    </titleStmt><publicationStmt><date when="2024-06-01" /></publicationStmt></fileDesc>
    <profileDesc><abstract> A concise abstract. </abstract></profileDesc>
    <sourceDesc><idno type="DOI">https://doi.org/10.1000/example</idno></sourceDesc>
    </teiHeader></TEI>
  `);
  assertEquals(suggestions.map((suggestion) => [suggestion.field, suggestion.value]), [
    ["title", "A Practical Paper"],
    ["authors", "Ada Lovelace"],
    ["doi", "10.1000/example"],
    ["description", "A concise abstract."],
    ["year", "2024"],
  ]);
});
