# Patient journey guide source and QA

The final 15-page guide explains fictional patient Kavita Rao's first admission through discharge. It follows current approved HIMS authority and clearly separates product rules from general hospital context. It contains no real patient data, private uploads or credentials. Its prose and tables are editable in Word.

## Files

- `generate_patient_journey.py`: retained prose, actor table, money comparisons and original process-diagram builder.
- `patient-journey-source.md`: generated readable prose source.
- [patient-journey.docx](patient-journey.docx) and [patient-journey.pdf](patient-journey.pdf): final editable guide and its matching PDF.
- `assets/`: three original labelled diagrams, eight implemented synthetic UI excerpts and their reconciled `screenshots.json` provenance.
- `qa/final/`: fresh 150 dpi Poppler pages, sequential and isolated PDFium cross-checks, extracted meaningful text, `validation.json` with file/page hashes and `visual-inspection.md` with author page-by-page findings.
- `patient-journey-draft.docx` and `qa/draft/`: separately retained historical draft artifacts.
- `export_word_pdf.ps1`: hidden native Word export constrained to this guide folder. It opens only the named generated guide and closes its own document/application.
- `validate_patient_journey.py`: retained source, money, screenshot integrity, PDF text and render provenance checks; generated QA stays ignored.

## Screenshot handoff

The controller supplied and reconciled final tested implemented UI excerpts for all eight keys: `admission`, `doctor`, `nursing`, `pharmacy`, `lab`, `insurance`, `billing`, `admin`. The manifest records the actual role, route/tab, synthetic capture and source/build/test identity. Capture source SHA256 is `021d46011ef00b58d6ef5a625052c89344c528fd82b61005d1db365ce65f36c0`; capture BUILD_ID is `hLrd-akC3hUxBtgEdxX8K`.

Each `screenshots.json` entry uses this shape:

```json
{
  "file": "admission.png",
  "kind": "implemented synthetic UI",
  "caption": "Admission interface example from the tested synthetic application. The screen record illustrates the workspace; it is separate from Kavita's fictional story.",
  "role": "ADMISSION",
  "route_or_tab": "controller supplies exact locator",
  "source_identity": "controller supplies exact identity"
}
```

`reconciled_with_implemented_ui` is true after all eight images and captions were checked against their implemented roles, tabs and actual visible records. Every caption explains that the screen's test records/counts are separate from Kavita's story. Embedded image hashes match the supplied assets. No Figma images are used.

## Authoring and rendering

Use the bundled runtime returned by the Codex workspace dependency loader. Do not run application checks or alter fixtures as part of document authoring.

```powershell
& 'C:/Users/prate/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' 'docs/guides/generate_patient_journey.py'
# Only after complete screenshot reconciliation
& 'C:/Users/prate/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' 'docs/guides/generate_patient_journey.py' --final
& 'docs/guides/export_word_pdf.ps1' -InputDocx 'docs/guides/patient-journey.docx' -OutputPdf 'docs/guides/patient-journey.pdf'
& 'C:/Users/prate/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe' -r 150 -png 'docs/guides/patient-journey.pdf' 'docs/guides/qa/final/page'
& 'C:/Users/prate/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' 'docs/guides/validate_patient_journey.py'
```

The required packaged `render_docx.py` was attempted. It failed because LibreOffice is absent on this Windows machine; hidden native Microsoft Word export is the controller-approved fallback. Word COM needs sandbox escalation. Final Word export succeeded without opening ordinary hospital files. Every fresh 150 dpi Poppler page was inspected individually; sequential PDFium proofs cross-check the previously questioned pages. Extraction preserves all 15 headings and 24,834 meaningful characters, the exact money examples and no draft image slots.

An apparent recurring-text omission occurred only in multi-image tool previews. Identical saved header pixel hashes on all 15 pages within each renderer and individual viewing disproved a PDF or renderer defect. A bounded PDF/A export trial was preserved at `qa/final/pre-pdfa/pdfa-trial.pdf`; it is QA evidence only. The original final PDF was restored byte-for-byte and freshly rendered/extracted. Default export remains ordinary Word PDF export. Do not regenerate final outputs after review without notifying the controller and repeating applicable visual QA.

Final hashes: DOCX `ace0c6206b098ca9c07d9339fc97d224e2d28e391e435ec5965c9e06334dfb6e` (431,881 bytes); PDF `60dbb206cfb603a160e81148901bdb51a1840c0fbe77e89b3ffdd83926c1dfde` (673,056 bytes). Detailed history and evidence are in [task-7-report.md](../../tmp/ui-redesign/task-7-report.md).

The artifact start marker was already run successfully exactly once for DOCX and once for PDF in this authoring task. Do not repeat it on routine regeneration.
