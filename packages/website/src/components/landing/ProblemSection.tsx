import { AlertTriangle, GitCompare, TrendingDown } from "lucide-react";

const problems = [
  {
    icon: AlertTriangle,
    question: "Are your MCP tools working correctly?",
    description: "LLM agents may misuse your tools, call them in wrong order, or miss them entirely. Without testing, you're shipping blind.",
  },
  {
    icon: GitCompare,
    question: "How do different LLMs compare?",
    description: "Claude, GPT-4, and other models behave differently with the same tools. Know which works best for your use case.",
  },
  {
    icon: TrendingDown,
    question: "Is the answer quality consistent over time?",
    description: "Model updates and server changes can silently break workflows. Catch regressions before your users do.",
  },
];

const ProblemSection = () => {
  return (
    <section className="section-problem py-20 border-t border-border/50">
      <div className="container mx-auto px-4">
        <div className="animate-fade-in-up text-center mb-14">
          <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">
            Why Test Your MCP Servers?
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Building MCP tools is only half the battle. Ensuring they work reliably with LLMs is the real challenge.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {problems.map((p, i) => (
            <div
              key={p.question}
              className="animate-fade-in-up rounded-xl border border-border bg-card p-6 hover:border-primary/30 transition-colors"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center mb-4">
                <p.icon className="w-5 h-5 text-secondary" />
              </div>
              <h3 className="font-display text-lg font-semibold mb-2">{p.question}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{p.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ProblemSection;
