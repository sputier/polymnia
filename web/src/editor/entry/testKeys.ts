/** Test helper: builds the KeyboardEvent a real keyboard would send for a combo like `Shift+C`. */
const NAMED: Record<string, { key: string; code: string; shift?: boolean }> = {
  Period: { key: '.', code: 'Period' },
  Plus: { key: '+', code: 'Equal', shift: true },
  Minus: { key: '-', code: 'Minus' },
  Equal: { key: '=', code: 'Equal' },
};

export function keyEvent(combo: string, mac = false): KeyboardEvent {
  const parts = combo.split('+');
  // `Mod+Plus` style combos never carry a bare "+" so a plain split is safe.
  const name = parts[parts.length - 1]!;
  const mods = parts.slice(0, -1);
  const shift = mods.includes('Shift');
  const mod = mods.includes('Mod');
  const named = NAMED[name];
  let key = name;
  let code = name;
  if (named) ({ key, code } = named);
  else if (/^[A-Z]$/.test(name)) {
    key = shift ? name : name.toLowerCase();
    code = `Key${name}`;
  } else if (/^[0-9]$/.test(name)) code = `Digit${name}`;
  return new KeyboardEvent('keydown', {
    key,
    code,
    shiftKey: shift || (named?.shift ?? false),
    ctrlKey: mod && !mac,
    metaKey: mod && mac,
    altKey: mods.includes('Alt'),
    bubbles: true,
    cancelable: true,
  });
}
