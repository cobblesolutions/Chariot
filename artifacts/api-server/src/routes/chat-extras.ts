import express, { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import * as api from "@workspace/api-zod";
import { db, messageAttachmentsTable, messageReactionsTable, messagesTable } from "@workspace/db";
import { requireStaff } from "../auth/session";
import { documentStorage } from "../services/document-storage";
import {
  attachmentView,
  canAccessMessage,
  reactionsForMessage,
} from "../services/message-extras";

const router: IRouter = Router();
router.use(requireStaff);

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const allowedAttachmentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/aac",
  "audio/x-m4a",
]);
const safeName = (name: string) => name.replace(/[\r\n\\/]/g, "_").slice(0, 255) || "attachment";

/** Uploads bytes for a chat message; the attachment is linked when the message is sent. */
router.post(
  "/chat/attachments",
  express.raw({ type: "*/*", limit: MAX_ATTACHMENT_BYTES }),
  async (req, res): Promise<void> => {
    const filename = safeName(req.header("x-filename") ?? "attachment");
    const contentType = (req.header("x-content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!Buffer.isBuffer(req.body) || req.body.length === 0 || !allowedAttachmentTypes.has(contentType)) {
      res.status(400).json({ error: "A filename and a supported attachment type are required" });
      return;
    }
    try {
      const stored = await documentStorage.put(req.body);
      const [row] = await db.insert(messageAttachmentsTable).values({
        uploadedByUserId: res.locals.authUser.id,
        name: filename,
        contentType,
        byteSize: stored.size,
        objectPath: stored.key,
      }).returning();
      res.status(201).json(api.UploadChatAttachmentResponse.parse(attachmentView(row!)));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Attachment upload failed" });
    }
  },
);

router.get("/chat/attachments/:id/download", async (req, res): Promise<void> => {
  const params = api.DownloadChatAttachmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid attachment" });
    return;
  }
  const [row] = await db.select().from(messageAttachmentsTable).where(eq(messageAttachmentsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  const userId = res.locals.authUser.id;
  if (row.messageId == null) {
    if (row.uploadedByUserId !== userId) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
  } else {
    const [message] = await db.select().from(messagesTable).where(eq(messagesTable.id, row.messageId));
    if (!message || !(await canAccessMessage(message, userId))) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
  }
  try {
    const bytes = await documentStorage.get(row.objectPath);
    res.setHeader("Content-Type", row.contentType);
    res.setHeader("Content-Length", String(bytes.length));
    // Types the in-app viewer can show are sent inline; everything else downloads.
    const inline = row.contentType.startsWith("image/") || row.contentType.startsWith("audio/") || row.contentType === "application/pdf" || row.contentType === "text/plain";
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    );
    res.send(bytes);
  } catch {
    res.status(404).json({ error: "Attachment not found" });
  }
});

/** Adds the emoji for the current user, or removes it if already present. */
router.post("/chat/messages/:id/reactions", async (req, res): Promise<void> => {
  const params = api.ToggleMessageReactionParams.safeParse(req.params);
  const body = api.ToggleMessageReactionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid reaction" });
    return;
  }
  const userId = res.locals.authUser.id;
  const [message] = await db.select().from(messagesTable).where(eq(messagesTable.id, params.data.id));
  if (!message || !(await canAccessMessage(message, userId))) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  const emoji = body.data.emoji.trim();
  const [existing] = await db.select({ id: messageReactionsTable.id }).from(messageReactionsTable).where(and(
    eq(messageReactionsTable.messageId, message.id),
    eq(messageReactionsTable.userId, userId),
    eq(messageReactionsTable.emoji, emoji),
  ));
  if (existing) {
    await db.delete(messageReactionsTable).where(eq(messageReactionsTable.id, existing.id));
  } else {
    await db.insert(messageReactionsTable).values({ messageId: message.id, userId, emoji });
  }
  res.json(api.ToggleMessageReactionResponse.parse(await reactionsForMessage(message.id, userId)));
});

export default router;
