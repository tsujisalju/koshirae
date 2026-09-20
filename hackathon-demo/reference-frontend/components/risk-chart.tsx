"use client";

import { Cell, Pie, PieChart } from "recharts";

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

interface Execution {
  risk: number;
}

interface RiskChartProps {
  executions: Execution[];
}

const chartConfig = {
  low: { label: "Low", color: "var(--color-emerald-500)" },
  medium: { label: "Medium", color: "var(--color-amber-500)" },
  high: { label: "High", color: "var(--color-red-500)" },
} satisfies ChartConfig;

export default function RiskChart({ executions }: RiskChartProps) {
  const data = [
    {
      range: "Low",
      bucket: "low",
      count: executions.filter((execution) => execution.risk < 30).length,
    },
    {
      range: "Medium",
      bucket: "medium",
      count: executions.filter(
        (execution) => execution.risk >= 30 && execution.risk < 60,
      ).length,
    },
    {
      range: "High",
      bucket: "high",
      count: executions.filter((execution) => execution.risk >= 60).length,
    },
  ];

  const total = executions.length;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-xl">Risk Distribution</CardTitle>
        <CardDescription>Share of executions by risk level</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="relative mx-auto h-64 max-w-72">
          <ChartContainer config={chartConfig} className="h-full w-full">
            <PieChart>
              <ChartTooltip
                content={<ChartTooltipContent nameKey="range" hideLabel />}
              />
              <Pie
                data={data}
                dataKey="count"
                nameKey="range"
                innerRadius={72}
                outerRadius={102}
                paddingAngle={3}
                strokeWidth={0}
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.bucket}
                    fill={`var(--color-${entry.bucket})`}
                  />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-semibold tabular-nums">{total}</span>
            <span className="text-xs text-muted-foreground">Executions</span>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          {data.map((item) => {
            const percentage = total === 0 ? 0 : Math.round((item.count / total) * 100);
            return (
              <div key={item.bucket} className="rounded-lg border border-border/60 px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={`size-2 rounded-sm ${
                      item.bucket === "low"
                        ? "bg-emerald-500"
                        : item.bucket === "medium"
                          ? "bg-amber-500"
                          : "bg-red-500"
                    }`}
                  />
                  {item.range}
                </div>
                <p className="mt-1 font-medium tabular-nums">{percentage}%</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
