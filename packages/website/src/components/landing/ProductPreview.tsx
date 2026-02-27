import { motion } from "framer-motion";
import screenshotResults from "@/assets/screenshot-results.png";
import screenshotTraces from "@/assets/screenshot-traces.png";

const BrowserFrame = ({ src, alt, label }: { src: string; alt: string; label: string }) => (
  <div className="rounded-xl border border-border bg-card overflow-hidden">
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border">
      <div className="flex gap-1">
        <div className="w-2.5 h-2.5 rounded-full bg-destructive/50" />
        <div className="w-2.5 h-2.5 rounded-full bg-secondary/50" />
        <div className="w-2.5 h-2.5 rounded-full bg-primary/50" />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground mx-auto">{label}</span>
    </div>
    <img src={src} alt={alt} className="w-full" loading="lazy" />
  </div>
);

const capabilities = [
  {
    title: "Core Capabilities",
    items: [
      "HTTP SSE Transport for MCP servers",
      "Multi-LLM support (OpenAI, Claude, Azure)",
      "Rich assertions & variance testing",
      "Detailed JSONL trace logs",
    ],
  },
  {
    title: "Analysis & Reporting",
    items: [
      "Trend analysis & LLM comparison",
      "HTML, JSON, Markdown outputs",
      "Custom metrics & KPI tracking",
      "Markdown reports for each run",
    ],
  },
  {
    title: "Developer Experience",
    items: [
      "Watch mode with auto-rerun",
      "YAML-based configuration",
      "Interactive HTML reports",
      "Multi-agent testing via CLI",
    ],
  },
];

const ProductPreview = () => {
  return (
    <section className="py-20 border-t border-border/50">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-14"
        >
          <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">
            See It in <span className="text-primary">Action</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Rich visual reports, detailed traces, and interactive dashboards.
          </p>
        </motion.div>

        {/* Screenshots */}
        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto mb-20">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <BrowserFrame src={screenshotResults} alt="Evaluation results view" label="Evaluation Results" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <BrowserFrame src={screenshotTraces} alt="Detailed execution traces" label="Execution Traces" />
          </motion.div>
        </div>

        {/* Capabilities */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {capabilities.map((cap, i) => (
            <motion.div
              key={cap.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              <h3 className="font-display font-semibold text-lg mb-4 text-primary">{cap.title}</h3>
              <ul className="space-y-2.5">
                {cap.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-primary mt-1 shrink-0">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ProductPreview;
