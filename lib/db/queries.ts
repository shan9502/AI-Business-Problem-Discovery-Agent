import * as sqliteQueries from "./queries.sqlite";
import * as pgQueries from "./queries.pg";

export function isPostgres(): boolean {
  return process.env.DATABASE_PROVIDER === "postgres";
}

export const dbQueries = isPostgres() ? pgQueries : sqliteQueries;

// For convenience, we can export individual functions as well so callers don't have to rewrite everything
export const createBusiness = dbQueries.createBusiness;
export const getBusinessById = dbQueries.getBusinessById;
export const updateBusiness = dbQueries.updateBusiness;
export const searchBusinesses = dbQueries.searchBusinesses;
export const getAllBusinesses = dbQueries.getAllBusinesses;
export const getBusinessesWithNames = dbQueries.getBusinessesWithNames;
export const getMissingFields = dbQueries.getMissingFields;

export const createConversation = dbQueries.createConversation;
export const getConversation = dbQueries.getConversation;
export const updateConversationSummary = dbQueries.updateConversationSummary;

export const addMessage = dbQueries.addMessage;
export const getRecentMessages = dbQueries.getRecentMessages;

export const executeRawQuery = dbQueries.executeRawQuery;
