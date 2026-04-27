import { getCompanyByRef, getContactsForCompanyId, getJobsForCompany, listCompanies, listContactLogForCompanyId, listOutcomeLogForCompanyId, openDatabase } from "../db.js";
import { companyOutreachSnapshotMap } from "../outreach-state.js";
import { buildCompanyAggregate, buildCompanyDossierView, mapCompanyRowToSummary } from "../mappers.js";
import type { CompanyDossierView, CompanyListRequest, CompanySummary, JobRecord } from "../../types.js";

export interface CompaniesService {
  list(request?: CompanyListRequest): CompanySummary[];
  dossier(companyRef: string): CompanyDossierView | undefined;
}

export function createCompaniesService(baseDir: string): CompaniesService {
  return {
    list(request = {}) {
      const { db } = openDatabase(baseDir);
      const outreach = companyOutreachSnapshotMap(db);
      return listCompanies(db, request.limit ?? 10).map((company) => mapCompanyRowToSummary(company, outreach.get(Number(company.id ?? 0))));
    },

    dossier(companyRef) {
      const { db } = openDatabase(baseDir);
      const company = getCompanyByRef(db, companyRef);
      if (!company) return undefined;
      const companyId = Number(company.id ?? 0);
      const outreach = companyOutreachSnapshotMap(db);
      const aggregate = buildCompanyAggregate(
        company,
        getJobsForCompany(db, companyId) as unknown as JobRecord[],
        getContactsForCompanyId(db, companyId),
        listContactLogForCompanyId(db, companyId),
        listOutcomeLogForCompanyId(db, companyId),
        outreach.get(companyId),
      );
      return buildCompanyDossierView(aggregate);
    },
  };
}
