/**
 * Forms that look the same as another form of their species. They are merged into
 * that form (dropped from `forms`). Votes are stored per species id, so dropping a
 * form never orphans a saved vote.
 *
 * Used by fetch-pokemon.mjs on a re-fetch and by prune-forms.mjs on the shipped data.
 */
export const MERGED_FORMS = new Map([
  // Greninja, Rockruff: ability variants with the base art.
  ["Battle Bond Greninja", "Greninja"],
  ["Own Tempo Rockruff", "Rockruff"],
  // Zygarde: Power Construct copies of 10% and 50%.
  ["50% Zygarde", "Zygarde (50% Forme)"],
  // Toxtricity: one Gigantamax look for both natures.
  ["Gigantamax Low Key Toxtricity", "Gigantamax Amped Toxtricity"],
  // Minior: every Meteor shell is the same; the cores differ.
  ["Orange Meteor Minior", "Red Meteor Minior"],
  ["Yellow Meteor Minior", "Red Meteor Minior"],
  ["Green Meteor Minior", "Red Meteor Minior"],
  ["Blue Meteor Minior", "Red Meteor Minior"],
  ["Indigo Meteor Minior", "Red Meteor Minior"],
  ["Violet Meteor Minior", "Red Meteor Minior"],
  // Pumpkaboo, Gourgeist: sizes share one artwork.
  ["Small Pumpkaboo", "Average Pumpkaboo"],
  ["Large Pumpkaboo", "Average Pumpkaboo"],
  ["Super Pumpkaboo", "Average Pumpkaboo"],
  ["Small Gourgeist", "Average Gourgeist"],
  ["Large Gourgeist", "Average Gourgeist"],
  ["Super Gourgeist", "Average Gourgeist"],
  // Mothim keeps no cloak.
  ["Mothim (sandy)", "Mothim (plant)"],
  ["Mothim (trash)", "Mothim (plant)"],
]);

/** True when a form should be merged away: totems, the list above, or a repeated name. */
export function isRedundantForm(form, seenNames) {
  if (/\btotem\b/i.test(form.name)) return true;
  if (MERGED_FORMS.has(form.name)) return true;
  if (seenNames && seenNames.has(form.name)) return true;
  return false;
}

export function pruneForms(forms) {
  const seen = new Set();
  const kept = [];
  for (const form of forms) {
    if (isRedundantForm(form, seen)) continue;
    seen.add(form.name);
    kept.push(form);
  }
  return kept;
}
