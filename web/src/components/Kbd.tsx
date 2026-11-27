import { formatKeys, isMac } from '../shortcuts/registry';

/** Renders a shortcut combo (`Mod+B`) as `<kbd>` badges, with platform-aware labels. */
export function Kbd({ keys }: { keys: string }) {
  return (
    <span className="kbds">
      {formatKeys(keys, isMac()).map((label, i) => (
        <kbd key={i}>{label}</kbd>
      ))}
    </span>
  );
}
