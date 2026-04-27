import {
  getCompanyByRef,
  getCompanyOutreachState,
  getJobById,
  logContactAttemptRow,
  logOutcomeRow,
  openDatabase,
  updateJobPipelineFields,
  upsertCompanyOutreachState,
} from "../db.js";
import { buildCompanyOutreachSnapshots } from "../outreach-state.js";
import type { CompanyOutreachSnapshot, ContactChannel, OutreachStatus } from "../../types.js";

export interface OutreachStatusService {
  setCompanyState(input: {
    companyRef: string;
    status: Exclude<OutreachStatus, "new" | "applied">;
    channel?: ContactChannel;
    jobId?: number;
    note?: string;
  }): CompanyOutreachSnapshot;
  getCompanyState(companyRef: string): CompanyOutreachSnapshot | null;
}

function statusToPipeline(status: Exclude<OutreachStatus, "new" | "applied">) {
  if (status === "sent_email") return "contacted" as const;
  if (status === "talking") return "reply_received" as const;
  if (status === "rejected") return "rejected" as const;
  if (status === "archived") return "archived" as const;
  return undefined;
}

export function createOutreachStatusService(baseDir: string): OutreachStatusService {
  return {
    setCompanyState({ companyRef, status, channel, jobId, note }) {
      const { db } = openDatabase(baseDir);
      const company = getCompanyByRef(db, companyRef);
      if (!company) {
        throw new Error(`Company not found: ${companyRef}`);
      }
      const companyId = Number(company.id ?? 0);
      if (!companyId) {
        throw new Error(`Company not found: ${companyRef}`);
      }

      const resolvedChannel = channel ?? (status === "sent_email" ? "email" : undefined);
      const existing = getCompanyOutreachState(db, companyId);
      upsertCompanyOutreachState(db, {
        companyId,
        status,
        lastContactChannel: resolvedChannel ?? existing?.last_contact_channel ?? "",
        lastJobId: jobId ?? existing?.last_job_id ?? null,
        note: note ?? "",
        source: "company_state_command",
      });

      if (status === "sent_email" && resolvedChannel) {
        logContactAttemptRow(db, companyId, resolvedChannel, note ?? "", jobId);
      }

      if (status === "talking") {
        logOutcomeRow(db, companyId, "positive_signal", note ?? "", jobId);
      } else if (status === "rejected") {
        logOutcomeRow(db, companyId, "rejected", note ?? "", jobId);
      }

      if (jobId) {
        const job = getJobById(db, jobId);
        if (!job) {
          throw new Error(`Job ${jobId} not found.`);
        }
        const pipelineStatus = statusToPipeline(status);
        if (pipelineStatus) {
          updateJobPipelineFields(db, jobId, { pipelineStatus });
        }
      }

      return buildCompanyOutreachSnapshots(db).find((snapshot) => snapshot.companyId === companyId)!;
    },

    getCompanyState(companyRef) {
      const { db } = openDatabase(baseDir);
      const company = getCompanyByRef(db, companyRef);
      if (!company) return null;
      const companyId = Number(company.id ?? 0);
      return buildCompanyOutreachSnapshots(db).find((snapshot) => snapshot.companyId === companyId) ?? null;
    },
  };
}
