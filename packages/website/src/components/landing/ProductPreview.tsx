import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import type { CarouselApi } from "@/components/ui/carousel";

const AUTOPLAY_INTERVAL = 4000;

const slides = [
  {
    src: "/screenshots/dashboard.png",
    label: "Dashboard",
    caption: "Track pass rates, latency trends and recent runs at a glance.",
  },
  {
    src: "/screenshots/run-evaluation-config.png",
    label: "Run Evaluation",
    caption: "Select scenarios, agents and variance runs — then hit Run.",
  },
  {
    src: "/screenshots/evaluation-results-overview.png",
    label: "Evaluation Results",
    caption: "See pass rates, tool usage and per-agent breakdowns in one view.",
  },
  {
    src: "/screenshots/evaluation-results-run-detail.png",
    label: "Run Detail",
    caption: "Inspect every check, extracted value, tool sequence and final answer.",
  },
  {
    src: "/screenshots/mcp-analysis-results-list.png",
    label: "MCP Analysis",
    caption: "Browse persisted tool-quality reports with severity breakdowns.",
  },
  {
    src: "/screenshots/analyze-mcp-tools-complete.png",
    label: "Tool Analysis",
    caption: "AI-powered review of your MCP tools for quality and LLM-readiness.",
  },
  {
    src: "/screenshots/evaluation-results-reference-reports.png",
    label: "Reference Reports",
    caption: "Compare runs side-by-side with AI-generated analysis and rankings.",
  },
  {
    src: "/screenshots/evaluation-results-assistance.png",
    label: "AI Assistant",
    caption: "Ask the AI assistant to explain results, spot patterns and suggest improvements.",
  },
];

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
      "CI-friendly CLI for scheduled runs",
      "Snapshot regression detection",
      "Interactive HTML reports",
      "Multi-agent testing via CLI",
    ],
  },
];

const ProductPreview = () => {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync current index
  useEffect(() => {
    if (!api) return;
    const update = () => setCurrent(api.selectedScrollSnap());
    api.on("select", update);
    update();
    return () => { api.off("select", update); };
  }, [api]);

  // Auto-play
  useEffect(() => {
    if (!api || paused) return;
    intervalRef.current = setInterval(() => api.scrollNext(), AUTOPLAY_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [api, paused]);

  const scrollTo = useCallback((i: number) => api?.scrollTo(i), [api]);
  const scrollPrev = useCallback(() => api?.scrollPrev(), [api]);
  const scrollNext = useCallback(() => api?.scrollNext(), [api]);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox]);

  return (
    <section id="product" className="section-preview py-20 border-t border-border/50">
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

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-5xl mx-auto"
        >
          {/* Carousel */}
          <div
            className="relative"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <Carousel setApi={setApi} opts={{ loop: true, align: "center" }} className="w-full">
              <CarouselContent>
                {slides.map((slide) => (
                  <CarouselItem key={slide.src}>
                    <div
                      className="rounded-xl border border-border bg-card overflow-hidden glow-primary cursor-zoom-in"
                      onClick={() => setLightbox(slide.src)}
                    >
                      {/* Browser chrome */}
                      <div className="flex items-center gap-2 px-4 py-3 bg-muted/50 border-b border-border">
                        <div className="flex gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-destructive/60" />
                          <div className="w-3 h-3 rounded-full bg-secondary/60" />
                          <div className="w-3 h-3 rounded-full bg-primary/60" />
                        </div>
                        <div className="flex-1 mx-4">
                          <div className="bg-background/50 rounded-md px-3 py-1 text-xs text-muted-foreground font-mono text-center">
                            {slide.label}
                          </div>
                        </div>
                      </div>
                      <div className="h-[420px] overflow-hidden">
                        <img
                          src={slide.src}
                          alt={slide.label}
                          className="w-full h-full object-cover object-top"
                          loading="lazy"
                        />
                      </div>
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
            </Carousel>

            {/* Prev / Next */}
            <button
              onClick={scrollPrev}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md hover:bg-muted transition-colors"
              aria-label="Previous slide"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={scrollNext}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md hover:bg-muted transition-colors"
              aria-label="Next slide"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Caption */}
          <p className="text-center text-sm text-muted-foreground mt-4 min-h-[20px]">
            {slides[current]?.caption}
          </p>

          {/* Dots */}
          <div className="flex justify-center gap-2 mt-4">
            {slides.map((slide, i) => (
              <button
                key={slide.src}
                onClick={() => scrollTo(i)}
                aria-label={`Go to ${slide.label}`}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === current ? "w-6 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground"
                }`}
              />
            ))}
          </div>
        </motion.div>

        {/* Capabilities */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto mt-20">
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

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setLightbox(null)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="relative max-w-6xl w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setLightbox(null)}
                className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors"
                aria-label="Close"
              >
                <X className="h-6 w-6" />
              </button>
              <img
                src={lightbox}
                alt="Full size screenshot"
                className="w-full rounded-xl shadow-2xl"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

export default ProductPreview;
