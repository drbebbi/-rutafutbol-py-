import type { EvaluationBundleContent } from "../../../../rules/bundle/bundle-content";

/**
 * SYNTHETIC KNOWLEDGE - NOT LAW.
 *
 * Every rule below is invented to exercise the engine's mechanics through the
 * HTTP layer. None of it is a statement about Paraguayan procedure, none of it
 * is derived from the research baseline, and it is served only by the gated
 * test-fixture route.
 *
 * Generated from `tests/golden/rule-sets/syn-standard.json`, which the golden
 * suite validates against the published rule schema.
 */
const SYNTHETIC_BUNDLE = {
  "schemaVersion": "evaluation-bundle@1.0",
  "ruleSetRevisions": [
    {
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "ruleSetId": "synthetic.test.ruleset",
      "publicationStatus": "PUBLISHED",
      "validFrom": "2000-01-01",
      "validUntil": null
    }
  ],
  "ruleRevisions": [
    {
      "ruleRevisionId": "00000000-0000-4000-8000-000000000001",
      "ruleId": "syn.case-type.from-none",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "CLASSIFICATION",
        "scope": "CASE",
        "condition": {
          "kind": "COMPARE",
          "path": "case.residence.reportedType",
          "operator": "EQ",
          "operand": {
            "kind": "STRING",
            "value": "NONE"
          }
        },
        "consequence": {
          "kind": "CASE_TYPE",
          "caseType": "STANDARD_FIRST_CEDULA_FROM_NONE"
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-000000000002",
      "ruleId": "syn.case-type.from-temporal",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "CLASSIFICATION",
        "scope": "CASE",
        "condition": {
          "kind": "COMPARE",
          "path": "case.residence.reportedType",
          "operator": "EQ",
          "operand": {
            "kind": "STRING",
            "value": "TEMPORAL"
          }
        },
        "consequence": {
          "kind": "CASE_TYPE",
          "caseType": "TEMPORAL_IDENTIFICACIONES_VERIFICATION_REQUIRED"
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-000000000003",
      "ruleId": "syn.residence.temporal",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "CLASSIFICATION",
        "scope": "CASE",
        "condition": {
          "kind": "COMPARE",
          "path": "case.residence.reportedType",
          "operator": "EQ",
          "operand": {
            "kind": "STRING",
            "value": "TEMPORAL"
          }
        },
        "consequence": {
          "kind": "RESIDENCE_CLASSIFICATION",
          "classification": "TEMPORAL"
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-000000000004",
      "ruleId": "syn.residence.none",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "CLASSIFICATION",
        "scope": "CASE",
        "condition": {
          "kind": "COMPARE",
          "path": "case.residence.reportedType",
          "operator": "EQ",
          "operand": {
            "kind": "STRING",
            "value": "NONE"
          }
        },
        "consequence": {
          "kind": "RESIDENCE_CLASSIFICATION",
          "classification": "NONE"
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-000000000005",
      "ruleId": "syn.visa.required",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "VISA",
        "scope": "CASE",
        "condition": {
          "kind": "COMPARE",
          "path": "case.residence.reportedType",
          "operator": "EQ",
          "operand": {
            "kind": "STRING",
            "value": "NONE"
          }
        },
        "consequence": {
          "purposeCode": "syn.residence-purpose",
          "requirement": "REQUIRED"
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-000000000006",
      "ruleId": "syn.procedure.residencia",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "PROCEDURE",
        "scope": "CASE",
        "condition": {
          "kind": "COMPARE",
          "path": "case.residence.reportedType",
          "operator": "EQ",
          "operand": {
            "kind": "STRING",
            "value": "NONE"
          }
        },
        "consequence": {
          "procedureId": "syn.residencia-temporal",
          "parameters": [],
          "discriminator": null,
          "requirement": "REQUIRED"
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-000000000007",
      "ruleId": "syn.procedure.cedula",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "PROCEDURE",
        "scope": "CASE",
        "condition": {
          "kind": "CONSTANT",
          "value": "TRUE"
        },
        "consequence": {
          "procedureId": "syn.cedula-first",
          "parameters": [],
          "discriminator": null,
          "requirement": "REQUIRED"
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-000000000008",
      "ruleId": "syn.dependency.cedula-after-residencia",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "DEPENDENCY",
        "scope": "CASE",
        "condition": {
          "kind": "COMPARE",
          "path": "case.residence.reportedType",
          "operator": "EQ",
          "operand": {
            "kind": "STRING",
            "value": "NONE"
          }
        },
        "consequence": {
          "dependent": {
            "procedureId": "syn.cedula-first",
            "parameters": [],
            "discriminator": null
          },
          "dependsOn": {
            "procedureId": "syn.residencia-temporal",
            "parameters": [],
            "discriminator": null
          },
          "relation": "REQUIRED_BEFORE"
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-000000000009",
      "ruleId": "syn.document.birth-certificate",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "DOCUMENT_REQUIREMENT",
        "scope": "CASE",
        "condition": {
          "kind": "CONSTANT",
          "value": "TRUE"
        },
        "consequence": {
          "forProcedure": {
            "procedureId": "syn.cedula-first",
            "parameters": [],
            "discriminator": null
          },
          "documentTypeId": "syn.birth-certificate",
          "issuingCountry": null,
          "discriminator": null,
          "requirement": "REQUIRED"
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-00000000000a",
      "ruleId": "syn.formality.apostille",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "DOCUMENT_FORMALITY",
        "scope": "CASE",
        "condition": {
          "kind": "CONSTANT",
          "value": "TRUE"
        },
        "consequence": {
          "forDocument": {
            "forProcedure": {
              "procedureId": "syn.cedula-first",
              "parameters": [],
              "discriminator": null
            },
            "documentTypeId": "syn.birth-certificate",
            "issuingCountry": null,
            "discriminator": null
          },
          "formalityCode": "syn.apostille",
          "requirement": "REQUIRED"
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-00000000000b",
      "ruleId": "syn.reuse.birth-certificate",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "DOCUMENT_REUSE",
        "scope": "CASE",
        "condition": {
          "kind": "CONSTANT",
          "value": "TRUE"
        },
        "consequence": {
          "forDocument": {
            "forProcedure": {
              "procedureId": "syn.cedula-first",
              "parameters": [],
              "discriminator": null
            },
            "documentTypeId": "syn.birth-certificate",
            "issuingCountry": null,
            "discriminator": null
          },
          "resolution": "REUSABLE_CONFIRMED"
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-00000000000c",
      "ruleId": "syn.fee.cedula",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "FEE",
        "scope": "CASE",
        "condition": {
          "kind": "CONSTANT",
          "value": "TRUE"
        },
        "consequence": {
          "forProcedure": {
            "procedureId": "syn.cedula-first",
            "parameters": [],
            "discriminator": null
          },
          "componentCode": "syn.official",
          "feeType": "FIXED_AMOUNT",
          "formula": {
            "kind": "FIXED",
            "amount": {
              "amountMinorUnits": 8500,
              "currency": "PYG"
            }
          }
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-00000000000d",
      "ruleId": "syn.fee.residencia",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "FEE",
        "scope": "CASE",
        "condition": {
          "kind": "COMPARE",
          "path": "case.residence.reportedType",
          "operator": "EQ",
          "operand": {
            "kind": "STRING",
            "value": "NONE"
          }
        },
        "consequence": {
          "forProcedure": {
            "procedureId": "syn.residencia-temporal",
            "parameters": [],
            "discriminator": null
          },
          "componentCode": "syn.official",
          "feeType": "INDEXED_AMOUNT",
          "formula": {
            "kind": "INDEXED",
            "multiplier": 25,
            "feeIndexId": "syn.jornal"
          }
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-00000000000e",
      "ruleId": "syn.warning.processing-time",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "WARNING",
        "scope": "CASE",
        "condition": {
          "kind": "CONSTANT",
          "value": "TRUE"
        },
        "consequence": {
          "code": "PROCESSING_TIME_INDICATION",
          "severity": "INFO",
          "qualifier": "syn-indication"
        }
      },
      "precedence": [],
      "evidence": [
        {
          "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
          "citationDetail": "synthetic"
        }
      ],
      "verification": null
    },
    {
      "ruleRevisionId": "00000000-0000-4000-8000-00000000000f",
      "ruleId": "syn.document.temporal-identificaciones-set",
      "ruleSetId": "synthetic.test.ruleset",
      "ruleSetRevisionId": "00000000-0000-4000-8000-00000000232a",
      "version": 1,
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFLICTING",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "payloadSchemaVersion": "rule-payload@1.0",
      "payload": {
        "family": "DOCUMENT_REQUIREMENT",
        "scope": "CASE",
        "condition": {
          "kind": "COMPARE",
          "path": "case.residence.reportedType",
          "operator": "EQ",
          "operand": {
            "kind": "STRING",
            "value": "TEMPORAL"
          }
        },
        "consequence": {
          "forProcedure": {
            "procedureId": "syn.cedula-first",
            "parameters": [],
            "discriminator": null
          },
          "documentTypeId": "syn.residence-evidence-document",
          "issuingCountry": null,
          "discriminator": null,
          "requirement": "REQUIRED"
        }
      },
      "precedence": [],
      "evidence": [],
      "verification": {
        "code": "TEMPORAL_IDENTIFICACIONES_DOCUMENT_SET",
        "targetKind": "PROCEDURE"
      }
    }
  ],
  "evidence": [
    {
      "sourceRevisionId": "00000000-0000-4000-8000-000000002329",
      "sourceId": "synthetic.test.source",
      "publicationStatus": "PUBLISHED",
      "language": "es",
      "retrievedAt": "2026-01-01T00:00:00Z",
      "locator": "synthetic://test-source"
    }
  ],
  "feeIndexRevisions": [
    {
      "feeIndexRevisionId": "00000000-0000-4000-8000-000000001780",
      "feeIndexId": "syn.jornal",
      "publicationStatus": "PUBLISHED",
      "verificationStatus": "CONFIRMED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "unitAmount": {
        "amountMinorUnits": 117077,
        "currency": "PYG"
      }
    }
  ],
  "productPolicyRevisions": [
    {
      "productPolicyRevisionId": "00000000-0000-4000-8000-000000001f3f",
      "productPolicyId": "synthetic.policy.mvp",
      "publicationStatus": "PUBLISHED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "supportedDesiredProcedures": [
        "FIRST_CEDULA"
      ]
    }
  ],
  "productCoverageRevisions": [
    {
      "productCoverageRevisionId": "00000000-0000-4000-8000-000000001b69",
      "productCoverageId": "synthetic.coverage.de",
      "publicationStatus": "PUBLISHED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "countryCode": "DE",
      "desiredProcedure": "FIRST_CEDULA",
      "state": "SUPPORTED"
    },
    {
      "productCoverageRevisionId": "00000000-0000-4000-8000-000000001b6a",
      "productCoverageId": "synthetic.coverage.br",
      "publicationStatus": "PUBLISHED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "countryCode": "BR",
      "desiredProcedure": "FIRST_CEDULA",
      "state": "NOT_SUPPORTED"
    }
  ],
  "pathwayDefinitionRevisions": [
    {
      "pathwayDefinitionRevisionId": "00000000-0000-4000-8000-000000001f53",
      "pathwayDefinitionId": "synthetic.pathway.syn-standard",
      "pathwayId": "syn-standard",
      "publicationStatus": "PUBLISHED",
      "validFrom": "2000-01-01",
      "validUntil": null,
      "appliesToCaseTypes": [
        "STANDARD_FIRST_CEDULA_FROM_NONE",
        "STANDARD_FIRST_CEDULA_FROM_TEMPORAL",
        "SPECIAL_CASE",
        "COUNTRY_NOT_SUPPORTED",
        "NOT_FIRST_CEDULA",
        "TEMPORAL_IDENTIFICACIONES_VERIFICATION_REQUIRED"
      ],
      "sections": [
        {
          "sectionKey": "residence",
          "order": 1,
          "procedureKeyPatterns": [
            "rp1:syn.residencia-temporal"
          ]
        },
        {
          "sectionKey": "cedula",
          "order": 2,
          "procedureKeyPatterns": [
            "rp1:syn.cedula-first"
          ]
        }
      ]
    }
  ]
} as unknown as EvaluationBundleContent;

export function syntheticKnowledgeBundle(): EvaluationBundleContent {
  return SYNTHETIC_BUNDLE;
}
