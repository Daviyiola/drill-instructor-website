"use strict";

/* eslint-disable require-jsdoc */

function catalogSubjectNames(catalog) {
  return (catalog && catalog.subjects || [])
      .map((row) => String(row && row.name || "").trim())
      .filter(Boolean);
}

function subjectLimits(bootcamp, catalog) {
  const available = catalogSubjectNames(catalog);
  const total = available.length;
  if (!total) return {minimum: 0, maximum: 0};
  if (String(bootcamp).toLowerCase() === "act") {
    return {minimum: Math.min(3, total), maximum: Math.min(4, total)};
  }
  if (String(bootcamp).toLowerCase() === "sat") {
    return {minimum: total, maximum: total};
  }
  return {minimum: 1, maximum: total};
}

function normalizeSubjects(value, catalog) {
  const available = catalogSubjectNames(catalog);
  const byKey = new Map(available.map((name) => [name.toLowerCase(), name]));
  const seen = new Set();
  const out = [];
  (Array.isArray(value) ? value : []).forEach((raw) => {
    const name = byKey.get(String(raw || "").trim().toLowerCase());
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  });
  return out;
}

function preferenceDescriptor(bootcamp, catalog, stored) {
  const availableSubjects = catalogSubjectNames(catalog);
  const limits = subjectLimits(bootcamp, catalog);
  const raw = Array.isArray(stored) ? stored :
    stored && Array.isArray(stored.selectedSubjects) ?
      stored.selectedSubjects : [];
  const normalized = normalizeSubjects(raw, catalog);
  const configured = normalized.length >= limits.minimum &&
    normalized.length <= limits.maximum;
  return {
    selectedSubjects: configured ? normalized :
      availableSubjects.slice(0, limits.maximum),
    availableSubjects,
    minimumSubjects: limits.minimum,
    maximumSubjects: limits.maximum,
    configured,
  };
}

function validatePreference(bootcamp, catalog, value) {
  const descriptor = preferenceDescriptor(bootcamp, catalog, value);
  const requested = Array.isArray(value) ? value : [];
  const normalized = normalizeSubjects(requested, catalog);
  if (normalized.length !== requested.length ||
      normalized.length < descriptor.minimumSubjects ||
      normalized.length > descriptor.maximumSubjects) {
    const error = new Error(
        `Choose between ${descriptor.minimumSubjects} and ` +
        `${descriptor.maximumSubjects} valid subjects`);
    error.code = 400;
    throw error;
  }
  return {...descriptor, selectedSubjects: normalized, configured: true};
}

module.exports = {
  catalogSubjectNames,
  normalizeSubjects,
  preferenceDescriptor,
  subjectLimits,
  validatePreference,
};
