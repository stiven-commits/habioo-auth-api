export interface N8NWorkflow {
    id: string;
    name: string;
    active: boolean;
    nodes: N8NNode[];
    connections: N8NConnections;
    settings?: N8NWorkflowSettings;
    createdAt?: string;
    updatedAt?: string;
    tags?: N8NTag[];
}

export interface N8NNode {
    id: string;
    name: string;
    type: string;
    typeVersion: number;
    position: [number, number];
    parameters?: Record<string, unknown>;
    credentials?: Record<string, N8NCredentialReference>;
    disabled?: boolean;
    notes?: string;
    notesInFlow?: boolean;
}

export interface N8NCredentialReference {
    id: string;
    name: string;
}

export interface N8NConnections {
    [nodeId: string]: {
        [outputIndex: string]: Array<Array<{
            node: string;
            type: string;
            index: number;
        }>>;
    };
}

export interface N8NWorkflowSettings {
    executionOrder?: string;
    executionTimeout?: number;
    errorWorkflow?: string;
    saveManualExecutions?: boolean;
    callerPolicy?: 'any' | 'workflowsFromAList' | 'none';
    callAllowedWorkflows?: string[];
}

export interface N8NTag {
    id: string;
    name: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface CreateWorkflowPayload {
    name: string;
    nodes: N8NNode[];
    connections: N8NConnections;
    settings?: N8NWorkflowSettings;
    tags?: string[];
    active?: boolean;
}

export interface UpdateWorkflowPayload {
    name?: string;
    nodes?: N8NNode[];
    connections?: N8NConnections;
    settings?: N8NWorkflowSettings;
    active?: boolean;
    tags?: string[];
}

export interface N8NApiResponse<T = unknown> {
    data?: T;
    message?: string;
    error?: string;
}

export interface WorkflowListResponse {
    workflows: Array<{
        id: string;
        name: string;
        active: boolean;
        createdAt?: string;
        updatedAt?: string;
        tags?: N8NTag[];
    }>;
}

export interface ExecutionResponse {
    id: string;
    workflowId: string;
    mode: string;
    startedAt: string;
    stoppedAt?: string;
    finished: boolean;
    status: 'success' | 'error' | 'waiting' | 'running';
}
