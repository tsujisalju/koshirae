"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

interface Execution {
  time: string;
  status: "APPROVED" | "FLAGGED" | "FAILED";
}

interface ExecutionChartProps {
  executions: Execution[];
}

const chartConfig = {
  approved: {
    label: "Approved",
    color: "var(--color-emerald-500)",
  },
  flagged: {
    label: "Flagged",
    color: "var(--color-amber-500)",
  },
  failed: {
    label: "Failed",
    color: "var(--color-red-500)",
  },
} satisfies ChartConfig;

export default function ExecutionChart({ executions }: ExecutionChartProps) {
  const groupedData = executions.reduce(
    (acc, execution) => {
      let bucket = acc.find((item) => item.time === execution.time);

      if (!bucket) {
        bucket = { time: execution.time, approved: 0, flagged: 0, failed: 0 };
        acc.push(bucket);
      }

      if (execution.status === "APPROVED") bucket.approved += 1;
      if (execution.status === "FLAGGED") bucket.flagged += 1;
      if (execution.status === "FAILED") bucket.failed += 1;

      return acc;
    },
    [] as { time: string; approved: number; flagged: number; failed: number }[],
  );

  return (
    <Card className="h-full">
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">Execution Activity</CardTitle>
            <CardDescription className="mt-1">
              Policy outcomes across autonomous agent actions
            </CardDescription>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-emerald-500" /> Approved
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-amber-500" /> Flagged
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-red-500" /> Failed
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="h-88">
        <ChartContainer config={chartConfig} className="h-full w-full">
          <BarChart data={groupedData} barCategoryGap="28%">
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="time" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="approved"
              stackId="outcome"
              fill="var(--color-approved)"
              radius={[0, 0, 3, 3]}
            />
            <Bar
              dataKey="flagged"
              stackId="outcome"
              fill="var(--color-flagged)"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="failed"
              stackId="outcome"
              fill="var(--color-failed)"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
