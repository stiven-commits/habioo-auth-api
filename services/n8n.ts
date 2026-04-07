import type {
    N8NWorkflow,
    CreateWorkflowPayload,
    UpdateWorkflowPayload,
    WorkflowListResponse,
    ExecutionResponse,
} from '../types/n8n';

const N8N_BASE_URL = process.env.N8N_BASE_URL || 'https://asistente.habioo.cloud';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

async function n8nRequest<T>(
    path: string,
    options: {
        method?: string;
        body?: unknown;
    } = {}
): Promise<T> {
    const { method = 'GET', body } = options;

    const url = `${N8N_BASE_URL}/api/v1${path}`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': N8N_API_KEY,
    };

    const fetchOptions: RequestInit = {
        method,
        headers,
    };

    if (body) {
        fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `n8n API error: ${response.status} ${response.statusText} - ${errorText}`
        );
    }

    const data = await response.json();
    return data as T;
}

async function listWorkflows(): Promise<WorkflowListResponse> {
    return n8nRequest<WorkflowListResponse>('/workflows');
}

async function getWorkflow(workflowId: string): Promise<N8NWorkflow> {
    return n8nRequest<N8NWorkflow>(`/workflows/${workflowId}`);
}

async function createWorkflow(
    payload: CreateWorkflowPayload
): Promise<N8NWorkflow> {
    return n8nRequest<N8NWorkflow>('/workflows', {
        method: 'POST',
        body: payload,
    });
}

async function updateWorkflow(
    workflowId: string,
    payload: UpdateWorkflowPayload
): Promise<N8NWorkflow> {
    return n8nRequest<N8NWorkflow>(`/workflows/${workflowId}`, {
        method: 'PUT',
        body: payload,
    });
}

async function deleteWorkflow(workflowId: string): Promise<{ message: string }> {
    return n8nRequest<{ message: string }>(`/workflows/${workflowId}`, {
        method: 'DELETE',
    });
}

async function activateWorkflow(
    workflowId: string
): Promise<N8NWorkflow> {
    return n8nRequest<N8NWorkflow>(`/workflows/${workflowId}/activate`, {
        method: 'POST',
    });
}

async function deactivateWorkflow(
    workflowId: string
): Promise<N8NWorkflow> {
    return n8nRequest<N8NWorkflow>(`/workflows/${workflowId}/deactivate`, {
        method: 'POST',
    });
}

async function listExecutions(params?: {
    workflowId?: string;
    limit?: number;
    status?: string;
}): Promise<{ data: ExecutionResponse[]; count: number }> {
    const searchParams = new URLSearchParams();
    if (params?.workflowId) searchParams.set('workflowId', params.workflowId);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.status) searchParams.set('status', params.status);

    const queryString = searchParams.toString();
    return n8nRequest<{ data: ExecutionResponse[]; count: number }>(
        `/executions${queryString ? `?${queryString}` : ''}`
    );
}

async function getExecution(executionId: string): Promise<ExecutionResponse> {
    return n8nRequest<ExecutionResponse>(`/executions/${executionId}`);
}

async function listTags(): Promise<Array<{ id: string; name: string }>> {
    return n8nRequest<Array<{ id: string; name: string }>>('/tags');
}

async function createTag(name: string): Promise<{ id: string; name: string }> {
    return n8nRequest<{ id: string; name: string }>('/tags', {
        method: 'POST',
        body: { name },
    });
}

async function deleteTag(tagId: string): Promise<{ message: string }> {
    return n8nRequest<{ message: string }>(`/tags/${tagId}`, {
        method: 'DELETE',
    });
}

async function testWebhook(
    webhookPath: string,
    payload: Record<string, unknown>
): Promise<unknown> {
    return n8nRequest<unknown>(`/webhooks/${webhookPath}`, {
        method: 'POST',
        body: payload,
    });
}

module.exports = {
    listWorkflows,
    getWorkflow,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    activateWorkflow,
    deactivateWorkflow,
    listExecutions,
    getExecution,
    listTags,
    createTag,
    deleteTag,
    testWebhook,
    N8N_BASE_URL,
};
