import { listContacts, openDatabase } from "../db.js";
import { mapContactRowToSummary } from "../mappers.js";
import type { ContactSummary, ContactsListRequest } from "../../types.js";

export interface ContactsService {
  list(request?: ContactsListRequest): ContactSummary[];
}

export function createContactsService(baseDir: string): ContactsService {
  return {
    list(request = {}) {
      const { db } = openDatabase(baseDir);
      return listContacts(db, request.companyRef).map(mapContactRowToSummary);
    },
  };
}
