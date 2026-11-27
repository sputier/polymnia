import { useState } from 'react';
import { shortcuts } from '../../shortcuts/registry';
import { CheatSheet } from './CheatSheet';
import { CommandPalette } from './CommandPalette';

export type DialogKind = 'palette' | 'sheet';

interface CommandDialogsProps {
  dialog: DialogKind;
  onClose: () => void;
  onOpen: (dialog: DialogKind) => void;
}

/** The command palette and the cheat sheet: one lazy chunk, loaded in idle time after start. */
export default function CommandDialogs({ dialog, onClose, onOpen }: CommandDialogsProps) {
  // The registry as it is when the dialog opens.
  const [list] = useState(() => shortcuts.list());
  return dialog === 'palette' ? (
    <CommandPalette list={list} onClose={onClose} />
  ) : (
    <CheatSheet list={list} onClose={onClose} onOpenPalette={() => onOpen('palette')} />
  );
}
