import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripComments } from './strip-comments.mjs';

test('stripComments treats processing instructions as opaque before CDATA', () => {
  const cases = [
    [
      '<svg><?probe <![CDATA[ ?><!-- remove --><![CDATA[x]]></svg>',
      '<svg><?probe <![CDATA[ ?><![CDATA[x]]></svg>',
    ],
    [
      '<svg><?probe <!-- literal --> ?><![CDATA[<!-- keep -->]]><!-- remove --></svg>',
      '<svg><?probe <!-- literal --> ?><![CDATA[<!-- keep -->]]></svg>',
    ],
    [
      '<svg><!-- <?probe <![CDATA[ ?> --><![CDATA[<?probe <!-- keep --> ?>]]></svg>',
      '<svg><![CDATA[<?probe <!-- keep --> ?>]]></svg>',
    ],
  ];
  for (const [input, expected] of cases) assert.equal(stripComments(input), expected);
});

test('stripComments preserves literal comment text in CDATA', () => {
  const cases = [
    [
      '<svg><!-- remove --><text><![CDATA[A <!-- literal --> B]]></text><!-- remove too --></svg>',
      '<svg><text><![CDATA[A <!-- literal --> B]]></text></svg>',
    ],
    [
      '<svg><text><![CDATA[<!-- unfinished]]></text><!-- remove --></svg>',
      '<svg><text><![CDATA[<!-- unfinished]]></text></svg>',
    ],
    [
      '<svg><text><![CDATA[<!<!---->-->]]></text></svg>',
      '<svg><text><![CDATA[<!<!---->-->]]></text></svg>',
    ],
    [
      '<svg><!-- <![CDATA[hidden]]> --><text><![CDATA[<!-- keep -->]]></text></svg>',
      '<svg><text><![CDATA[<!-- keep -->]]></text></svg>',
    ],
    [
      '<svg><text><![CDATA[left <!-- a -->]]><![CDATA[<!-- b --> right]]></text></svg>',
      '<svg><text><![CDATA[left <!-- a -->]]><![CDATA[<!-- b --> right]]></text></svg>',
    ],
  ];
  for (const [input, expected] of cases) assert.equal(stripComments(input), expected);
});

test('stripComments retains removal behavior outside CDATA', () => {
  const cases = [
    ['', ''],
    ['<svg/>', '<svg/>'],
    ['<svg><!-- one\n two --><text>&lt;!-- literal --&gt;</text></svg>', '<svg><text>&lt;!-- literal --&gt;</text></svg>'],
    ['<!<!---->-->', '>'],
    ['<!<!---->--', ''],
    ['<!--<!-- a -->', ''],
    ['<<!---->!-- x -->', ''],
    ['a<!-- never closed', 'a never closed'],
    ['<![C<!---->DATA[<!<!---->--x]]>', '<![CDATA[x]]>'],
  ];
  for (const [input, expected] of cases) assert.equal(stripComments(input), expected);
});
