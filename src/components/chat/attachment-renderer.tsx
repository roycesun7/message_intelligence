"use client";

import { useAttachmentData } from "@/hooks/use-messages";
import type { AttachmentData } from "@/types";

interface AttachmentRendererProps {
  messageId: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageAttachment({ attachment }: { attachment: AttachmentData }) {
  if (!attachment.dataUrl) return null;

  return (
    <img
      src={attachment.dataUrl}
      alt={attachment.transferName ?? "Image"}
      className="max-w-full rounded-[16px] object-contain"
      style={{ maxHeight: 300 }}
      loading="lazy"
    />
  );
}

function FileAttachment({ attachment }: { attachment: AttachmentData }) {
  const name = attachment.transferName ?? attachment.filename?.split("/").pop() ?? "File";
  const size = attachment.totalBytes > 0 ? formatFileSize(attachment.totalBytes) : "";
  const ext = name.split(".").pop()?.toUpperCase() ?? "";

  return (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-white/[0.08] px-3 py-2.5 min-w-[180px]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.1] text-[11px] font-semibold text-zinc-400">
        {ext}
      </div>
      <div className="flex flex-col overflow-hidden">
        <span className="truncate text-[13px] text-zinc-200">{name}</span>
        {size && <span className="text-[11px] text-zinc-500">{size}</span>}
      </div>
    </div>
  );
}

/** Hide Apple internal metadata files (URL previews, sticker payloads, etc.) */
function isHiddenAttachment(att: AttachmentData): boolean {
  const fname = att.filename ?? att.transferName ?? "";
  return fname.endsWith(".pluginPayloadAttachment");
}

export function AttachmentRenderer({ messageId }: AttachmentRendererProps) {
  const { data: attachments, isLoading } = useAttachmentData(messageId);

  if (isLoading || !attachments || attachments.length === 0) return null;

  const visible = attachments.filter((a) => !isHiddenAttachment(a));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {visible.map((att) => {
        if (att.dataUrl) {
          return <ImageAttachment key={att.rowid} attachment={att} />;
        }
        return <FileAttachment key={att.rowid} attachment={att} />;
      })}
    </div>
  );
}
