# Phrase source batches

Each collection uses one UTF-8 JSON file per batch, named `idioms-01.json`, `proverbs-01.json`, or `quotes-01.json` with a two-digit sequence number. Each file follows `../schema.json` and contains no more than 40 items. Keep batches in numeric order so IDs remain stable.

Batch `01` holds the original built-in entries in their original order. Its IDs are permanent: `idm-0001` through `idm-0024`, `prv-0001` through `prv-0024`, and `qte-0001` through `qte-0020`. Do not edit or reorder these records during content expansion.

The validator may warn on inherited legacy examples, quote source dates, and the existing glitters/glisters duplicate. Those exceptions are bounded by `assets/phrases/_progress.json` → `existingInHtml`; new records must meet every validation rule and must not use legacy IDs.
