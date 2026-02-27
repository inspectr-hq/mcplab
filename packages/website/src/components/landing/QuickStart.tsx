import { useState } from "react";
import { motion } from "framer-motion";
import { Copy, Check, FlaskConical, BarChart3, Microscope } from "lucide-react";

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="absolute top-3 right-3 p-1.5 rounded-md bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check size={14} className="text-primary" /> : <Copy size={14} />}
    </button>
  );
};

const yamlConfig = `servers:
  my-server:
    transport: "http"
    url: "http://localhost:3000/mcp"

agents:
  claude:
    provider: "anthropic"
    model: "claude-haiku-4-5-20251001"
    temperature: 0

scenarios:
  - id: "basic-test"
    agent: "claude"
    servers: ["my-server"]
    prompt: "Use the tools to complete this task..."
    eval:
      tool_constraints:
        required_tools: ["my_tool"]
      response_assertions:
        - type: "regex"
          pattern: "success|completed"`;

const QuickStart = () => {
  return (
    <section id="quickstart" className="py-20 border-t border-border/50">
      <div className="container mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-12 max-w-6xl mx-auto">
          {/* Quick Start */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl font-bold mb-2">
              <span className="text-primary">Quick</span> Start
            </h2>
            <p className="text-muted-foreground mb-8">Up and running in under a minute.</p>

            {/* Install command */}
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-2 font-mono">1. Install</p>
              <div className="relative rounded-lg bg-muted/50 border border-border p-4 font-mono text-sm">
                <CopyButton text="npx @inspectr/mcplab --help" />
                <span className="text-muted-foreground">$</span>{" "}
                <span className="text-foreground">npx @inspectr/mcplab --help</span>
              </div>
            </div>

            {/* Config */}
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-2 font-mono">2. Create eval config</p>
              <div className="relative rounded-lg bg-muted/50 border border-border p-4 font-mono text-xs leading-relaxed overflow-x-auto max-h-64 overflow-y-auto">
                <CopyButton text={yamlConfig} />
                <pre className="text-foreground/90">{yamlConfig}</pre>
              </div>
            </div>

            {/* Run */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-mono">3. Run evaluation</p>
              <div className="relative rounded-lg bg-muted/50 border border-border p-4 font-mono text-sm">
                <CopyButton text="npx @inspectr/mcplab run -c eval.yaml" />
                <span className="text-muted-foreground">$</span>{" "}
                <span className="text-foreground">npx @inspectr/mcplab run -c eval.yaml</span>
              </div>
            </div>
          </motion.div>

          {/* AI-Powered Tools */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-3xl font-bold mb-2">
              <span className="text-secondary">AI-Powered</span> Tools
            </h2>
            <p className="text-muted-foreground mb-8">Built-in AI assistants to supercharge your workflow.</p>

            <div className="space-y-5">
              {[
                {
                  title: "Scenario Assistant",
                  Icon: FlaskConical,
                  description: "AI chat to help design and refine evaluation scenarios. Describe what you want to test and get ready-to-use YAML configurations.",
                },
                {
                  title: "Result Assistant",
                  Icon: BarChart3,
                  description: "AI chat to analyze and explain completed run results. Understand failures, spot patterns, and get actionable improvement suggestions.",
                },
                {
                  title: "MCP Tool Analysis",
                  Icon: Microscope,
                  description: "Automated review of your MCP tool definitions for quality, safety, and LLM-friendliness. Get recommendations before testing.",
                },
              ].map((tool) => (
                <div
                  key={tool.title}
                  className="rounded-xl border border-border bg-card p-5 hover:border-secondary/30 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0">
                      <tool.Icon className="w-5 h-5 text-secondary" />
                    </div>
                    <div>
                      <h3 className="font-display font-semibold mb-1">{tool.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{tool.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default QuickStart;
