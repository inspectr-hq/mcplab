import { ArrowLeftRight, ExternalLink } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const resultUrl = (runId: string, configId?: string | null) => {
  const params = new URLSearchParams();
  if (configId) params.set("configId", configId);
  params.set("embed", "1");
  return `/results/${encodeURIComponent(runId)}?${params.toString()}`;
};

const CompareResultDetails = () => {
  const [searchParams] = useSearchParams();
  const left = searchParams.get("left") ?? "";
  const right = searchParams.get("right") ?? "";
  const leftConfig = searchParams.get("leftConfig");
  const rightConfig = searchParams.get("rightConfig");

  if (!left || !right) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Full Result Compare</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select exactly two runs in Compare and use the “Compare full results” action.
          </p>
          <Button asChild variant="outline">
            <Link to="/compare">Back to Compare</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Full Result Compare</h1>
          <p className="text-sm text-muted-foreground">
            Side-by-side Result Detail views for deep inspection.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/compare">
              <ArrowLeftRight className="mr-1.5 h-4 w-4" />
              Back to Compare
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/results/${encodeURIComponent(left)}${leftConfig ? `?configId=${encodeURIComponent(leftConfig)}` : ""}`} target="_blank" rel="noreferrer">
              Open Left
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/results/${encodeURIComponent(right)}${rightConfig ? `?configId=${encodeURIComponent(rightConfig)}` : ""}`} target="_blank" rel="noreferrer">
              Open Right
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-mono">{left}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <iframe
              title={`Result ${left}`}
              src={resultUrl(left, leftConfig)}
              className="h-[calc(100vh-15rem)] w-full border-0"
            />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-mono">{right}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <iframe
              title={`Result ${right}`}
              src={resultUrl(right, rightConfig)}
              className="h-[calc(100vh-15rem)] w-full border-0"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CompareResultDetails;
