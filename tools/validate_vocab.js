#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const vocabDir = path.join(root, "vocab");
const indexPath = path.join(vocabDir, "index.js");
const progressPath = path.join(vocabDir, "_progress.json");
const requiredFields = ["id", "term", "pos", "vi", "def", "ex", "exVi"];
const banned = ["...", "todo", "etc."];

function fail(message) {
  throw new Error(message);
}

function readIndex() {
  const text = fs.readFileSync(indexPath, "utf8");
  const match = text.match(/^\s*window\.VOCAB_INDEX\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!match) fail("vocab/index.js phải gán một đối tượng JSON cho window.VOCAB_INDEX");
  let index;
  try {
    index = JSON.parse(match[1]);
  } catch (error) {
    fail(`vocab/index.js sai cú pháp JSON: ${error.message}`);
  }
  if (!index || !Array.isArray(index.books)) fail("VOCAB_INDEX.books phải là một danh sách");
  return index;
}

function walkJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkJs(full);
    return entry.isFile() && entry.name.endsWith(".js") && full !== indexPath ? [full] : [];
  });
}

function normalizeTerm(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en").trim().replace(/\s+/g, " ");
}

function main() {
  const index = readIndex();
  const unitsById = new Map();
  const bookByUnit = new Map();
  const fileToUnit = new Map();

  for (const book of index.books) {
    if (!book || typeof book.id !== "string" || !Array.isArray(book.units)) {
      fail("Mỗi bộ sách phải có id và danh sách units");
    }
    book.count = 0;
    for (const unit of book.units) {
      if (!unit || typeof unit.id !== "string") fail(`Unit không có id trong bộ ${book.id}`);
      if (unitsById.has(unit.id)) fail(`Trùng id unit: ${unit.id}`);
      if (!Array.isArray(unit.files) || unit.files.length === 0) {
        fail(`Unit ${unit.id} chưa khai báo đường dẫn file`);
      }
      unit.count = 0;
      unitsById.set(unit.id, unit);
      bookByUnit.set(unit.id, book.id);
      for (const relative of unit.files) {
        if (fileToUnit.has(relative)) fail(`Một file được gán cho nhiều unit: ${relative}`);
        fileToUnit.set(relative, unit.id);
      }
    }
  }

  const allIds = new Map();
  const termsByBook = new Map();
  const entriesByUnit = new Map([...unitsById.keys()].map((id) => [id, []]));
  const files = walkJs(vocabDir).sort();

  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (!fileToUnit.has(relative)) fail(`File JS chưa có trong index: ${relative}`);
    const text = fs.readFileSync(file, "utf8");
    const match = text.match(/^\s*window\.VOCAB\.register\(("(?:[^"\\]|\\.)*"),\s*(\[[\s\S]*\])\);\s*$/);
    if (!match) fail(`Sai cú pháp register hoặc JSON trong ${relative}`);
    const registeredId = JSON.parse(match[1]);
    const expectedId = fileToUnit.get(relative);
    if (registeredId !== expectedId) fail(`${relative} đăng ký ${registeredId}, nhưng index khai báo ${expectedId}`);
    const records = JSON.parse(match[2]);
    if (!Array.isArray(records)) fail(`Dữ liệu trong ${relative} phải là một mảng`);
    if (records.length > 40) fail(`${relative} có ${records.length} mục; tối đa 40`);

    for (const [position, record] of records.entries()) {
      const where = `${relative} mục ${position + 1}`;
      if (!record || typeof record !== "object" || Array.isArray(record)) fail(`${where} không phải object`);
      const missing = requiredFields.filter((field) => !(field in record));
      if (missing.length) fail(`${where} thiếu trường: ${missing.join(", ")}`);
      for (const field of [...requiredFields, "ipa"]) {
        if (field in record && typeof record[field] !== "string") fail(`${where}: ${field} phải là chuỗi`);
      }
      if ("ielts" in record && ![0, 1].includes(record.ielts)) fail(`${where}: ielts chỉ nhận 0 hoặc 1`);
      if ("note" in record && typeof record.note !== "string") fail(`${where}: note phải là chuỗi`);
      for (const value of Object.values(record)) {
        if (typeof value === "string" && banned.some((marker) => value.toLocaleLowerCase("en").includes(marker))) {
          fail(`${where}: phát hiện văn bản cấm`);
        }
      }
      const id = record.id.trim();
      const term = record.term.trim();
      if (!id || !term) fail(`${where}: id và term không được để trống`);
      if (allIds.has(id)) fail(`Trùng id mục ${id}: ${allIds.get(id)} và ${relative}`);
      allIds.set(id, relative);
      const bookId = bookByUnit.get(registeredId);
      if (!termsByBook.has(bookId)) termsByBook.set(bookId, new Map());
      const termKey = normalizeTerm(term);
      if (termsByBook.get(bookId).has(termKey)) fail(`Trùng term trong bộ ${bookId}: ${term} (${relative})`);
      termsByBook.get(bookId).set(termKey, relative);
      entriesByUnit.get(registeredId).push(record);
    }
  }

  const missingFiles = [];
  for (const book of index.books) {
    for (const unit of book.units) {
      unit.count = entriesByUnit.get(unit.id).length;
      book.count += unit.count;
      for (const relative of unit.files) if (!fs.existsSync(path.join(root, relative))) missingFiles.push(relative);
    }
  }

  let loadedItems = 0;
  let completedItems = 0;
  let doneUnits = 0;
  let pendingUnits = 0;
  const progressBooks = index.books.map((book) => {
    const units = book.units.map((unit) => {
      const plannedCount = Number(unit.plannedCount) || 0;
      const done = plannedCount > 0 && unit.count >= plannedCount;
      loadedItems += unit.count;
      doneUnits += Number(done);
      pendingUnits += Number(!done);
      if (done) completedItems += unit.count;
      return { id: unit.id, status: done ? "done" : "pending", count: unit.count, plannedCount };
    });
    return {
      id: book.id,
      status: units.every((unit) => unit.status === "done") ? "done" : "pending",
      count: book.count,
      plannedCount: Number(book.plannedCount) || 0,
      units,
    };
  });

  fs.writeFileSync(indexPath, `window.VOCAB_INDEX = ${JSON.stringify(index, null, 2)};\n`, "utf8");
  fs.writeFileSync(progressPath, `${JSON.stringify({
    version: 1,
    books: progressBooks,
    totals: {
      loadedItems,
      completedItems,
      doneUnits,
      pendingUnits,
      missingFiles: new Set(missingFiles).size,
    },
  }, null, 2)}\n`, "utf8");
  console.log(`OK: ${index.books.length} bộ, ${unitsById.size} units, ${loadedItems} mục; ${doneUnits} units done, ${pendingUnits} pending; ${new Set(missingFiles).size} file dự kiến chưa tạo.`);
}

try {
  main();
} catch (error) {
  console.error(`LỖI: ${error.message}`);
  process.exitCode = 1;
}

