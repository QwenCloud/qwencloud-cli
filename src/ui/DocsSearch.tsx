import React from 'react';
import { Box, Text } from 'ink';
import { Section } from './Section.js';
import { renderWithInk } from './render.js';
import { colors } from './theme.js';
import type { DocsSearchViewModel, DocsSearchItemViewModel } from '../view-models/docs/index.js';

export interface DocsSearchInkProps {
  vm: DocsSearchViewModel;
}

/**
 * Renders highlighted text by colorizing fragments wrapped in `<em>` tags.
 * The view-model layer keeps the raw markup so we can re-style here.
 */
function HighlightedText({ value }: { value: string }) {
  if (!value) return null;
  const parts = value.split(/(<em>[\s\S]*?<\/em>)/gi);
  return (
    <Text>
      {parts.map((part, idx) => {
        const m = part.match(/^<em>([\s\S]*?)<\/em>$/i);
        if (m) {
          return (
            <Text key={idx} color={colors.accent} bold>
              {m[1]}
            </Text>
          );
        }
        return <Text key={idx}>{part}</Text>;
      })}
    </Text>
  );
}

function DocsSearchItem({
  item,
  placeholder,
}: {
  item: DocsSearchItemViewModel;
  placeholder: string;
}) {
  if (item.isDegraded) {
    return (
      <Box paddingLeft={2}>
        <Text color={colors.muted}>{placeholder}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box>
        {item.subBizType ? <Text color={colors.muted}>{item.subBizType} </Text> : null}
        <HighlightedText value={item.highlightedTitle || item.title} />
      </Box>
      {item.url ? <Text color={colors.muted}>{item.url}</Text> : null}
      {item.breadcrumb && item.breadcrumb.length > 0 ? (
        <Text color={colors.muted}>{item.breadcrumb.join(' > ')}</Text>
      ) : null}
      {item.summary ? <HighlightedText value={item.highlightedSummary || item.summary} /> : null}
      <Text> </Text>
    </Box>
  );
}

export function DocsSearchInk({ vm }: DocsSearchInkProps) {
  const subtitle = `"${vm.query}"`;

  if (vm.isEmpty) {
    return (
      <Section title="Docs Search" subtitle={subtitle}>
        <Box paddingLeft={2}>
          <Text color={colors.muted}>No results.</Text>
        </Box>
      </Section>
    );
  }

  if (vm.isAllDegraded) {
    return (
      <Section title="Docs Search" subtitle={subtitle}>
        <Box paddingLeft={2}>
          <Text color={colors.muted}>{vm.degradedPlaceholder}, please retry later.</Text>
        </Box>
      </Section>
    );
  }

  const footer = `${vm.totalCount} results  \u00b7  Page ${vm.page} of ${vm.pageCount}`;
  const banner = vm.diagnostics.includes('search.fields_incomplete')
    ? vm.degradedPlaceholder
    : null;

  return (
    <Section title="Docs Search" subtitle={subtitle} footer={footer}>
      {banner ? (
        <Box paddingLeft={2}>
          <Text color={colors.muted}>Note: {banner}.</Text>
        </Box>
      ) : null}
      {vm.items.map((item, idx) => (
        <DocsSearchItem key={idx} item={item} placeholder={vm.degradedPlaceholder} />
      ))}
    </Section>
  );
}

export async function renderDocsSearchInk(vm: DocsSearchViewModel): Promise<void> {
  await renderWithInk(<DocsSearchInk vm={vm} />);
}
