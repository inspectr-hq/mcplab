import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';

const bashGrammar = Prism.languages.bash;
const maybeFunction = bashGrammar?.function;

if (maybeFunction && !Array.isArray(maybeFunction) && 'pattern' in maybeFunction && maybeFunction.pattern instanceof RegExp) {
  maybeFunction.pattern = new RegExp(maybeFunction.pattern.source.replace('|npm|', '|npm|npx|'), maybeFunction.pattern.flags);
}

export default Prism;
