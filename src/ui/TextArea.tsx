import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { colors } from './theme.js';

export interface TextAreaProps {
  /** Header text shown above the editor */
  title?: string;
  /** Placeholder when empty */
  placeholder?: string;
  /** Called with the final text when user confirms via the Submit button */
  onSubmit: (text: string) => void;
  /** Called when user cancels (Esc / Ctrl+C / Cancel button) */
  onCancel: () => void;
}

type Focus = 'editor' | 'buttons';
type ButtonId = 'submit' | 'cancel';

/**
 * Multi-line text editor with a button bar. Two focus regions — the editor
 * grid and the button row — are toggled via Tab. Submission flows through
 * the explicit Submit button rather than a control-key shortcut so it never
 * collides with terminal EOF semantics.
 */
export function TextArea({ title, placeholder, onSubmit, onCancel }: TextAreaProps) {
  const { exit } = useApp();
  const [lines, setLines] = useState<string[]>(['']);
  const [cursorRow, setCursorRow] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [focus, setFocus] = useState<Focus>('editor');
  const [selectedButton, setSelectedButton] = useState<ButtonId>('submit');

  const cancel = () => {
    onCancel();
    exit();
  };

  const submit = () => {
    onSubmit(lines.join('\n'));
    exit();
  };

  useInput((input, key) => {
    // Global cancel shortcuts.
    if (input === '\x03' || (input === 'c' && key.ctrl)) {
      cancel();
      return;
    }
    if (key.escape) {
      cancel();
      return;
    }

    // Tab toggles focus between editor and button bar.
    if (key.tab) {
      setFocus((f) => (f === 'editor' ? 'buttons' : 'editor'));
      return;
    }

    if (focus === 'buttons') {
      if (key.leftArrow || key.rightArrow) {
        setSelectedButton((b) => (b === 'submit' ? 'cancel' : 'submit'));
        return;
      }
      if (key.return) {
        if (selectedButton === 'submit') submit();
        else cancel();
        return;
      }
      // Other keys are ignored while the button bar holds focus.
      return;
    }

    // ── Editor focus from here on ──────────────────────────────────────

    // Enter → split current line at cursor and move down.
    if (key.return) {
      setLines((prev) => {
        const current = prev[cursorRow] ?? '';
        const before = current.slice(0, cursorCol);
        const after = current.slice(cursorCol);
        const next = [...prev];
        next.splice(cursorRow, 1, before, after);
        return next;
      });
      setCursorRow((r) => r + 1);
      setCursorCol(0);
      return;
    }

    // Backspace / Delete → remove char before cursor or merge with previous line.
    if (key.backspace || key.delete) {
      if (cursorCol > 0) {
        setLines((prev) => {
          const next = [...prev];
          const line = next[cursorRow] ?? '';
          next[cursorRow] = line.slice(0, cursorCol - 1) + line.slice(cursorCol);
          return next;
        });
        setCursorCol((c) => c - 1);
      } else if (cursorRow > 0) {
        const prevLineLen = lines[cursorRow - 1]?.length ?? 0;
        setLines((prev) => {
          const next = [...prev];
          next[cursorRow - 1] = (next[cursorRow - 1] ?? '') + (next[cursorRow] ?? '');
          next.splice(cursorRow, 1);
          return next;
        });
        setCursorRow((r) => r - 1);
        setCursorCol(prevLineLen);
      }
      return;
    }

    // Arrow navigation. The cursor column is clamped against the destination
    // line length to mimic typical text-editor behaviour.
    if (key.upArrow) {
      if (cursorRow > 0) {
        const target = lines[cursorRow - 1]?.length ?? 0;
        setCursorRow((r) => r - 1);
        setCursorCol((c) => Math.min(c, target));
      }
      return;
    }
    if (key.downArrow) {
      if (cursorRow < lines.length - 1) {
        const target = lines[cursorRow + 1]?.length ?? 0;
        setCursorRow((r) => r + 1);
        setCursorCol((c) => Math.min(c, target));
      }
      return;
    }
    if (key.leftArrow) {
      if (cursorCol > 0) {
        setCursorCol((c) => c - 1);
      } else if (cursorRow > 0) {
        const target = lines[cursorRow - 1]?.length ?? 0;
        setCursorRow((r) => r - 1);
        setCursorCol(target);
      }
      return;
    }
    if (key.rightArrow) {
      const lineLen = lines[cursorRow]?.length ?? 0;
      if (cursorCol < lineLen) {
        setCursorCol((c) => c + 1);
      } else if (cursorRow < lines.length - 1) {
        setCursorRow((r) => r + 1);
        setCursorCol(0);
      }
      return;
    }

    // Plain character input (multi-byte sequences from IME / paste also land here).
    if (input && !key.ctrl && !key.meta) {
      setLines((prev) => {
        const next = [...prev];
        const line = next[cursorRow] ?? '';
        next[cursorRow] = line.slice(0, cursorCol) + input + line.slice(cursorCol);
        return next;
      });
      setCursorCol((c) => c + input.length);
    }
  });

  const isEmpty = lines.length === 1 && lines[0] === '';
  const lineNumberWidth = String(Math.max(lines.length, 1)).length;
  const editorFooter = '↑↓←→ Move  Enter New line  Tab Switch focus';
  const buttonFooter = '←→ Select  Enter Confirm  Tab Back to editor';

  return (
    <Box flexDirection="column">
      {title ? (
        <Box marginBottom={1}>
          <Text bold color={colors.brand}>
            {title}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" borderStyle="single" borderColor={colors.darkPurple} paddingX={1}>
        {isEmpty && placeholder ? (
          <Text color={colors.muted}>{placeholder}</Text>
        ) : (
          lines.map((line, rowIdx) => (
            <Box key={rowIdx}>
              <Text color={colors.muted}>{String(rowIdx + 1).padStart(lineNumberWidth)} </Text>
              {focus === 'editor' && rowIdx === cursorRow ? (
                renderLineWithCursor(line, cursorCol)
              ) : (
                <Text>{line || ' '}</Text>
              )}
            </Box>
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={colors.muted}>{focus === 'editor' ? editorFooter : buttonFooter}</Text>
      </Box>
      <Box marginTop={1}>
        {renderButton('submit', 'Submit', focus, selectedButton)}
        <Text>{'    '}</Text>
        {renderButton('cancel', 'Cancel', focus, selectedButton)}
      </Box>
    </Box>
  );
}

/**
 * Render a single line with an inverted character at the cursor position.
 * When the cursor sits past the end of the line, a space is inverted so the
 * caret remains visible.
 */
function renderLineWithCursor(line: string, cursorCol: number): React.ReactElement {
  const before = line.slice(0, cursorCol);
  const at = line[cursorCol] ?? ' ';
  const after = line.slice(cursorCol + 1);
  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  );
}

/**
 * Render a single button. The active selection is highlighted with the brand
 * color and an arrow prefix, but only while the button bar holds focus —
 * when the editor is focused, both buttons are dimmed to reduce visual noise.
 */
function renderButton(
  id: ButtonId,
  label: string,
  focus: Focus,
  selected: ButtonId,
): React.ReactElement {
  const isActive = focus === 'buttons' && selected === id;
  if (isActive) {
    return (
      <Text bold color={colors.brand}>
        {`[ ▸ ${label} ]`}
      </Text>
    );
  }
  return <Text color={colors.muted}>{`[ ${label} ]`}</Text>;
}
