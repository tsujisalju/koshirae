import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Execution {
  id: string;
  agent: string;
  action: string;
  amount: number;
  risk: number;
  status: "APPROVED" | "FLAGGED" | "FAILED";
  time: string;
}

interface ExecutionTableProps {
  executions: Execution[];
}

export default function ExecutionTable({ executions }: ExecutionTableProps) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-xl">Recent Executions</CardTitle>
        <CardDescription>Latest autonomous actions and policy outcomes.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Risk</TableHead>
              <TableHead className="text-right">Time</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {executions.map((execution) => (
              <TableRow key={execution.id}>
                <TableCell className="font-medium">{execution.agent}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {execution.action}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{execution.amount.toLocaleString()} SUI</TableCell>
                <TableCell className="text-right tabular-nums">{execution.risk}/100</TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">{execution.time}</TableCell>
                <TableCell className="text-right">
                  <Badge
                    variant="outline"
                    className={
                      execution.status === "APPROVED"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : execution.status === "FLAGGED"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                          : "border-red-500/30 bg-red-500/10 text-red-400"
                    }
                  >
                    {execution.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
