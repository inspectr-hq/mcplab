import React from 'react';
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import type { CarouselApi } from "@/components/ui/carousel";

const AUTOPLAY_INTERVAL = 4000;

type Slide = { src: string; label: string; caption: string };

const ScreenshotCarousel = ({ slides }: { slides: Slide[] }) => {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogIndex, setDialogIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!api) return;
    const update = () => setCurrent(api.selectedScrollSnap());
    api.on("select", update);
    update();
    return () => { api.off("select", update); };
  }, [api]);

  useEffect(() => {
    if (!api || paused) return;
    intervalRef.current = setInterval(() => api.scrollNext(), AUTOPLAY_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [api, paused]);

  const scrollTo = useCallback((i: number) => api?.scrollTo(i), [api]);
  const scrollPrev = useCallback(() => api?.scrollPrev(), [api]);
  const scrollNext = useCallback(() => api?.scrollNext(), [api]);

  const openDialog = useCallback((index: number) => {
    setDialogIndex(index);
    setDialogOpen(true);
  }, []);

  const showPreviousDialogSlide = useCallback(() => {
    setDialogIndex((currentIndex) => (currentIndex - 1 + slides.length) % slides.length);
  }, [slides.length]);

  const showNextDialogSlide = useCallback(() => {
    setDialogIndex((currentIndex) => (currentIndex + 1) % slides.length);
  }, [slides.length]);

  const activeDialogSlide = slides[dialogIndex];

  return (
    <>
      <div
        className="relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <Carousel setApi={setApi} opts={{ loop: true, align: "center" }} className="w-full">
          <CarouselContent>
            {slides.map((slide, index) => (
              <CarouselItem key={slide.src}>
                <div
                  className="rounded-xl border border-border bg-card overflow-hidden glow-primary cursor-zoom-in"
                  onClick={() => openDialog(index)}
                >
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

      <p className="text-center text-sm text-muted-foreground mt-4 min-h-[20px]">
        {slides[current]?.caption}
      </p>

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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[min(96vw,1400px)] max-w-[1400px] border-none bg-background p-4 shadow-[0_30px_100px_rgba(0,0,0,0.45)] sm:rounded-2xl md:p-6">
          <DialogTitle className="pr-10 text-left text-lg md:text-xl">
            {activeDialogSlide.label}
          </DialogTitle>
          <DialogDescription className="text-left text-sm leading-6 md:text-base">
            {activeDialogSlide.caption}
          </DialogDescription>

          <div className="mt-2 overflow-hidden rounded-2xl border bg-muted/20">
            <img
              src={activeDialogSlide.src}
              alt={activeDialogSlide.label}
              className="max-h-[75vh] w-full object-contain"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              {dialogIndex + 1} / {slides.length}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-full"
                onClick={showPreviousDialogSlide}
                aria-label="Show previous screenshot"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-full"
                onClick={showNextDialogSlide}
                aria-label="Show next screenshot"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ScreenshotCarousel;
