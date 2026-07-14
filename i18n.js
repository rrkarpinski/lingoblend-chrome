/**
 * LingoBlend i18n helper — v0.8.0
 * Loads the active UI language dict from localization/{lang}.json and
 * exposes t(key, vars) for lookups with {placeholder} interpolation.
 * No pluralization logic — deliberately linguistically approximate.
 */
let dict = {};
let currentLang = 'en';

export async function initI18n() {
  const data = await chrome.storage.local.get(['uiLang']);
  currentLang = data.uiLang || (navigator.language.startsWith('pl') ? 'pl' : 'en');
  await loadDict(currentLang);
  return currentLang;
}

async function loadDict(lang) {
  const url = chrome.runtime.getURL(`localization/${lang}.json`);
  const resp = await fetch(url);
  dict = resp.ok ? await resp.json() : {};
}

export async function setLang(lang) {
  currentLang = lang;
  await chrome.storage.local.set({ uiLang: lang });
  await loadDict(lang);
}

export function getLang() {
  return currentLang;
}

export function t(key, vars = {}) {
  let str = dict[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, v);
  }
  return str;
}

export function applyStaticI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
}