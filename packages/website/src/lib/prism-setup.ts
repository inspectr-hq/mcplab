import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';

// Custom grammar for MCPLab CLI commands
Prism.languages.mcplab = {
  comment: {
    pattern: /#.*/
  },
  string: {
    pattern: /"[^"]*"|'[^']*'/,
    greedy: true
  },
  // @inspectr/mcplab package — must come before binary so the slash isn't split
  package: {
    pattern: /@inspectr\/mcplab\S*/,
    alias: 'function'
  },
  // mcplab binary, npx, npm → function color
  binary: {
    pattern: /\b(?:mcplab|npx|npm)\b/,
    alias: 'function'
  },
  // subcommands → purple
  subcommand: {
    pattern: /\b(?:run|app|report|install)\b/,
    alias: 'keyword'
  },
  // --flags and -f → orange (only when not preceded by a word char, e.g. not inside "basic-test")
  flag: {
    pattern: /(?<!\w)--?[a-zA-Z][\w-]*/,
    alias: 'operator'
  },
  // ./paths and ~/paths → green (reuse string color)
  path: {
    pattern: /(?:\.{0,2}\/|~\/)\S*/,
    alias: 'string'
  },
  number: {
    pattern: /\b\d+\b/
  }
};

export default Prism;
