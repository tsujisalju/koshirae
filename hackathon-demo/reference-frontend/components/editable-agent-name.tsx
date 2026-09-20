"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { saveAgentMetadata } from "@/lib/agent-service";

export default function EditableAgentName({
  name,
  capId,
  owner,
  onSaved,
  className,
}: {
  name: string;
  capId: string | undefined;
  owner: string | undefined;
  onSaved: (newName: string) => void;
  className?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const canEdit = Boolean(capId && owner);

  function startEditing(event: React.MouseEvent) {
    if (!canEdit || isEditing) return;
    event.stopPropagation();
    setDraft(name);
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft(name);
    setIsEditing(false);
  }

  async function commitEditing() {
    const trimmed = draft.trim();

    if (!trimmed || trimmed === name) {
      cancelEditing();
      return;
    }

    if (!capId || !owner) {
      cancelEditing();
      return;
    }

    setIsSaving(true);

    try {
      await saveAgentMetadata({ capId, owner, name: trimmed });
      setIsEditing(false);
      onSaved(trimmed);
    } catch (error: unknown) {
      toast.warning("Could not rename agent", {
        description: error instanceof Error ? error.message : String(error),
      });
      cancelEditing();
    } finally {
      setIsSaving(false);
    }
  }

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        autoFocus
        value={draft}
        disabled={isSaving}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitEditing}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelEditing();
          }
        }}
        className={cn("h-auto py-0", className)}
      />
    );
  }

  return (
    <span
      onClick={startEditing}
      className={cn(
        "group/name inline-flex items-center gap-2 rounded-sm",
        canEdit && "cursor-text hover:bg-muted/40",
        className,
      )}
    >
      {name}
      {canEdit && (
        <Pencil className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100" />
      )}
    </span>
  );
}
