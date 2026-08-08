import type { Parent, PhrasingContent, Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

function splitSoftBreakText(value: string): PhrasingContent[] {
  const segments = value.split(/\r?\n/);
  const replacement: PhrasingContent[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment) {
      replacement.push({ type: 'text', value: segment });
    }

    if (index < segments.length - 1) {
      replacement.push({ type: 'break' });
    }
  }

  return replacement;
}

export function remarkPreserveSoftBreaks() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent: Parent | undefined) => {
      if (index === undefined || !parent || !node.value.includes('\n')) {
        return;
      }

      const replacement = splitSoftBreakText(node.value);
      if (replacement.length === 0) {
        parent.children.splice(index, 1);
        return index;
      }

      parent.children.splice(index, 1, ...replacement);
      return index + replacement.length;
    });
  };
}
