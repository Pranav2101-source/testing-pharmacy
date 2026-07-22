package com.checkup.pharmacy.modules.pharmacy.dto;

import com.fasterxml.jackson.databind.JsonNode;

/** PATCH /pharmacy/documents body: { documents: StoredDoc[] }. */
public record UpdateDocumentsRequest(JsonNode documents) {
}
