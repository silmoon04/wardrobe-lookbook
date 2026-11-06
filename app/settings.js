import {setShadowsEnabled} from './shadows.js';
let DEFAULTS = {shadows:true};
const OPTIONS = {theme:['light','warm','dark'],density:['comfortable','compact'],background:['neutral','studio','warm','check'],size:['small','medium','large'],browse:['rail','grid'],shoes:['none','af1','garment'],labels:['short','full']};
let KEY;
export function loadSettings(profile, defaults) {
  KEY = `wardrobe:${profile}:settings`;
  DEFAULTS = {shadows:true,...defaults};
  let raw;
  try {raw = JSON.parse(localStorage.getItem(KEY)||'{}');} catch {raw={};}
  const result = {...DEFAULTS};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key,values] of Object.entries(OPTIONS)) if (values.includes(raw[key])) result[key] = raw[key];
  if (/^#[0-9a-f]{6}$/i.test(raw.accent)) result.accent = raw.accent;
  for (const key of ['slots','agent','details','saved','shadows']) if (typeof raw[key] === 'boolean') result[key] = raw[key];
  return result;
}
export function applySettings(settings) {
  setShadowsEnabled(settings.shadows);
  for (const key of ['theme','density','background','size','labels']) document.documentElement.dataset[key] = settings[key];
  if (!settings.accent) return;
  document.documentElement.style.setProperty('--accent',settings.accent);
  // Choose a readable action label for both very pale and very dark custom accents.
  const rgb = settings.accent.slice(1).match(/../g).map(c => parseInt(c,16)/255).map(v => v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  const luminance = .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  document.documentElement.style.setProperty('--on-accent',luminance > .179 ? '#171820' : '#ffffff');
  const slots=document.querySelector('#slots'); if (slots) slots.hidden = !settings.slots;
  document.querySelector('.studio-body')?.classList.toggle('no-slots',!settings.slots);
  for (const [key,id] of [['agent','agent-panel'],['details','piece-detail'],['saved','saved-section']]) {const el=document.getElementById(id); if (el) el.hidden = !settings[key];}
  for (const field of document.querySelectorAll('[data-setting]')) {
    if (field.type === 'checkbox') field.checked = settings[field.dataset.setting];
    else field.value = settings[field.dataset.setting];
  }
  const shoes=document.querySelector('#mannequin-shoes'); if (shoes) shoes.value = settings.shoes;
}
export function saveSettings(settings) {localStorage.setItem(KEY,JSON.stringify(settings));}
