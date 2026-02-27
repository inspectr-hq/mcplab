import { Button } from "@/components/ui/button";
import { Github, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import screenshotDashboard from "@/assets/screenshot-dashboard.png";

const Hero = () => {
  return (
    <section className="relative pt-32 pb-20 overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-4xl mx-auto"
        >
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
            Lab for Testing{" "}
            <span className="text-primary glow-text">MCP Servers</span>{" "}
            with LLMs
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            Test how well LLM agents use your MCP tools, compare different models, and track quality over time with automated testing and detailed reports.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="font-semibold text-base gap-2" asChild>
              <a href="#quickstart">
                Get Started <ArrowRight size={18} />
              </a>
            </Button>
            <Button size="lg" variant="outline" className="font-semibold text-base gap-2" asChild>
              <a href="https://github.com/inspectr-dev/mcplab" target="_blank" rel="noopener noreferrer">
                <Github size={18} /> View on GitHub
              </a>
            </Button>
          </div>
        </motion.div>

        {/* Screenshot in browser frame */}
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="mt-16 max-w-5xl mx-auto"
        >
          <div className="rounded-xl border border-border bg-card overflow-hidden glow-primary">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 px-4 py-3 bg-muted/50 border-b border-border">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-destructive/60" />
                <div className="w-3 h-3 rounded-full bg-secondary/60" />
                <div className="w-3 h-3 rounded-full bg-primary/60" />
              </div>
              <div className="flex-1 mx-4">
                <div className="bg-background/50 rounded-md px-3 py-1 text-xs text-muted-foreground font-mono text-center">
                  localhost:5173
                </div>
              </div>
            </div>
            <img
              src={screenshotDashboard}
              alt="MCPLab dashboard showing evaluation results and test scenarios"
              className="w-full"
              loading="lazy"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Hero;
