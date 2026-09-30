import { type AgreementTypeDto, agreementTypesDto } from "@app/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type DragEvent, type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { api, formErrorHandler } from "../lib/api.ts";
import { kb } from "../lib/format.ts";
import { Button, Field, Input, Modal, Select } from "./ui.tsx";

const ACCEPT = ".pdf,.docx,.txt,.md";

function guessType(name: string): AgreementTypeDto {
  const n = name.toLowerCase();
  if (n.includes("nda")) return "NDA";
  if (n.includes("msa")) return "MSA";
  if (n.includes("saas")) return "SaaS";
  if (n.includes("employ")) return "Employment";
  return "Other";
}

export function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<AgreementTypeDto>("NDA");
  const [title, setTitle] = useState("");
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setType(guessType(f.name));
    setErrors({});
  };
  const reset = () => {
    setFile(null);
    setTitle("");
    setErrors({});
  };

  const upload = useMutation({
    mutationFn: () => api.uploadAgreement(file!, type, title),
    onSuccess: (a) => {
      toast.success(`Uploaded ${a.fileName}. Extracting text, then the audit starts by itself.`);
      void qc.invalidateQueries({ queryKey: ["agreements"] });
      reset();
      onClose();
      void navigate({ to: "/agreements/$agreementId", params: { agreementId: a.id } });
    },
    onError: formErrorHandler(setErrors),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setErrors({ file: "Choose a file to upload" });
    upload.mutate();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };

  return (
    <Modal open={open} onClose={onClose} title="Upload agreement">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
            errors.file ? "border-danger bg-danger-soft" : dragging ? "border-brand bg-brand/5" : "border-line hover:border-brand/50"
          }`}
        >
          {file ? (
            <>
              <span className="font-medium">{file.name}</span>
              <span className="text-sm text-muted">{kb(file.size)} · click to choose another</span>
            </>
          ) : (
            <>
              <span className="font-medium">Drop a file here or click to browse</span>
              <span className="text-sm text-muted">PDF, DOCX, TXT or MD, up to 20 MB</span>
            </>
          )}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          aria-label="Agreement file"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {errors.file && (
          <p role="alert" className="-mt-2 text-sm text-danger">
            {errors.file}
          </p>
        )}
        <Field label="Agreement type" error={errors.agreementType} hint="Decides which rules apply.">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as AgreementTypeDto)}>
              {agreementTypesDto.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Title (optional)" hint="Defaults to the file name.">
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="NDA with Acme" />}
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={upload.isPending}>
            {upload.isPending ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
