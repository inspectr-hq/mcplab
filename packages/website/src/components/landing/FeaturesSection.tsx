import { motion } from "framer-motion";
import { Layers, ShieldCheck, Repeat, FileSearch, TrendingUp, FileCode } from "lucide-react";

const features = [
  {
    icon: Layers,
    title: "Multi-LLM Support",
    description: "Test with OpenAI, Anthropic Claude, and Azure OpenAI side-by-side on the same scenarios.",
  },
  {
    icon: ShieldCheck,
    title: "Rich Assertions",
    description: "Validate tool usage, call sequences, response content with regex, and custom metrics.",
  },
  {
    icon: Repeat,
    title: "Variance Testing",
    description: "Run multiple iterations to measure stability and consistency of agent behavior.",
  },
  {
    icon: FileSearch,
    title: "Detailed Traces",
    description: "JSONL logs of every tool call and LLM response for deep debugging.",
  },
  {
    icon: TrendingUp,
    title: "Trend Analysis",
    description: "Track pass rates, latency, and performance metrics over time.",
  },
  {
    icon: FileCode,
    title: "YAML Configuration",
    description: "Declarative, version-controllable eval specs. Easy to read, write, and share.",
  },
];

const FeaturesSection = () => {
  return (
    <section id="features" className="py-20 border-t border-border/50">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-14"
        >
          <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">
            Everything You Need to{" "}
            <span className="text-primary">Evaluate</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            A comprehensive toolkit for testing MCP server quality across models.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="group rounded-xl border border-border bg-card p-6 hover:border-primary/30 transition-all hover:bg-accent/30"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-display font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
