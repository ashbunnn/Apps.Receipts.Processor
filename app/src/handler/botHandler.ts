import { IRead, IHttp } from "@rocket.chat/apps-engine/definition/accessors";
import { getAPIConfig, LLMProvider } from "../config/settings";

export class BotHandler {
    constructor(private readonly http: IHttp, private readonly read: IRead) {}

    public async processResponse(prompt: string): Promise<any> {
        const { apiKey, modelType, apiEndpoint, provider } = await getAPIConfig(
            this.read
        );
        const requestBody = this.createRequest(
            provider,
            modelType,
            "You are a useful assistant",
            prompt
        );

        return await this.sendRequest(
            provider,
            apiEndpoint,
            apiKey,
            requestBody,
            modelType
        );
    }

    private createRequest(
        provider: LLMProvider,
        modelType: string,
        systemPrompt: string,
        prompt: string
    ) {
        switch (provider) {
            case LLMProvider.GEMINI:
                return this.createGeminiRequest(systemPrompt, prompt);
            case LLMProvider.OPENAI:
            case LLMProvider.OTHER:
            default:
                return this.createOpenAICompatibleRequest(
                    modelType,
                    systemPrompt,
                    prompt
                );
        }
    }

    private createOpenAICompatibleRequest(
        modelType: string,
        systemPrompt: string,
        prompt: string
    ) {
        return {
            model: modelType,
            messages: [
                {
                    role: "system",
                    content: systemPrompt,
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: prompt,
                        },
                    ],
                },
            ],
            temperature: 0.1,
        };
    }

    private createGeminiRequest(systemPrompt: string, prompt: string) {
        return {
            systemInstruction: {
                parts: [{ text: systemPrompt }],
            },
            contents: [
                {
                    parts: [
                        {
                            text: prompt,
                        },
                    ],
                },
            ],
            generationConfig: {
                temperature: 0.1,
            },
        };
    }

    private async sendRequest(
        provider: LLMProvider,
        apiEndpoint: string,
        apiKey: string,
        requestBody: any,
        modelType: string
    ) {
        const headers = this.getRequestHeaders(provider, apiKey);
        const url = this.getRequestUrl(provider, apiEndpoint, modelType, apiKey);

        const response = await this.http.post(url, {
            headers,
            data: requestBody,
        });

        if (response.statusCode !== 200) {
            throw new Error(
                `API error: ${response.statusCode} - ${
                    response.data?.error?.message || "Unknown error"
                }`
            );
        }

        return this.extractResponse(provider, response.data);
    }

    private getRequestHeaders(provider: LLMProvider, apiKey: string) {
        const baseHeaders = {
            "Content-Type": "application/json",
        };

        switch (provider) {
            case LLMProvider.GEMINI:
                return baseHeaders;
            case LLMProvider.OPENAI:
            case LLMProvider.OTHER:
            default:
                return {
                    ...baseHeaders,
                    Authorization: `Bearer ${apiKey}`,
                };
        }
    }

    private getRequestUrl(
        provider: LLMProvider,
        apiEndpoint: string,
        modelType: string,
        apiKey: string
    ): string {
        switch (provider) {
            case LLMProvider.GEMINI:
                return `${apiEndpoint}/${modelType}:generateContent?key=${apiKey}`;
            case LLMProvider.OPENAI:
            case LLMProvider.OTHER:
            default:
                return apiEndpoint;
        }
    }

    private extractResponse(provider: LLMProvider, responseData: any): string {
        switch (provider) {
            case LLMProvider.GEMINI:
                return (
                    responseData.candidates?.[0]?.content?.parts?.[0]?.text || ""
                );
            case LLMProvider.OPENAI:
            case LLMProvider.OTHER:
            default:
                return responseData.choices?.[0]?.message?.content || "";
        }
    }
}
