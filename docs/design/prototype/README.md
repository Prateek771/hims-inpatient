# Preserved Figma prototype source

The original project-specific files were copied into the main project folder during consolidation on 9 October 2026. Their SHA-256 hashes matched the external originals before cleanup. One extra trailing blank line was then removed from the builder to satisfy the repository whitespace check; its script content is otherwise unchanged. The state JSON retains its original bytes.

- [hims-figma-builder.js](hims-figma-builder.js): the Figma script used to populate the role screens with existing foundations and node IDs.
- [hims-figma-state.json](hims-figma-state.json): the saved file, node and design-state record from prototype creation.

These files preserve generation history. They are not application code, an exported Figma file or a complete standalone reconstruction script. The builder depends on existing Figma nodes and can modify them; do not execute it as setup. Use the [approved design reference](../../DESIGN_REFERENCE.md) and inspect the current Figma file before UI implementation or design edits. All patient details here are synthetic.
