import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import ProblemSection from "@/components/landing/ProblemSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import ProductPreview from "@/components/landing/ProductPreview";
import PackagesSection from "@/components/landing/PackagesSection";
import QuickStart from "@/components/landing/QuickStart";
import Footer from "@/components/landing/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <Hero />
      <ProblemSection />
      <FeaturesSection />
      <ProductPreview />
      <PackagesSection />
      <QuickStart />
      <Footer />
    </div>
  );
};

export default Index;
