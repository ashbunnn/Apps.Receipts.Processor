import { IRead, IHttp } from "@rocket.chat/apps-engine/definition/accessors";
import {
    IMessage,
    IMessageAttachment,
} from "@rocket.chat/apps-engine/definition/messages";
import { getAPIConfig, LLMProvider } from "../config/settings";
import { OCR_SYSTEM_PROMPT, RECEIPT_VALIDATION_PROMPT } from "../const/prompt";

export class ImageHandler {
    constructor(private readonly http: IHttp, private readonly read: IRead) {}

    public async processImage(message: IMessage, prompt: string): Promise<any> {
        const { apiKey, modelType, apiEndpoint, provider } = await getAPIConfig(
            this.read
        );
        const base64Image = await this.convertImageToBase64(message);
        const requestBody = this.createOCRRequest(
            provider,
            modelType,
            prompt,
            base64Image
        );

        return await this.sendRequest(provider, apiEndpoint, apiKey, requestBody, modelType);
    }

    public async validateImage(message: IMessage): Promise<boolean> {
        try {
            const response = await this.processImage(
                message,
                RECEIPT_VALIDATION_PROMPT
            );
            const jsonResponse = JSON.parse(response);
            return jsonResponse.is_receipt === true;
        } catch (error) {
            console.error("Error validating image:", error);
            return false;
        }
    }

    public static isImageAttachment(attachment: IMessageAttachment): boolean {
        return attachment.imageUrl !== undefined;
    }

    private async convertImageToBase64(message: IMessage): Promise<string> {
        try {
            const image = await this.read
                .getUploadReader()
                .getBufferById(message.file?._id!);
            return image.toString("base64");
        } catch (error) {
            throw error;
        }
    }

    private createOCRRequest(
        provider: LLMProvider,
        modelType: string,
        prompt: string,
        base64Image: string
    ) {
        const systemPrompt = OCR_SYSTEM_PROMPT
        switch (provider) {
            case LLMProvider.GEMINI:
                return this.createGeminiRequest(systemPrompt, prompt, base64Image);

            case LLMProvider.OPENAI:
            case LLMProvider.OTHER:
            default:
                return this.createOpenAICompatibleRequest(modelType, systemPrompt, prompt, base64Image);
        }
    }

    private createOpenAICompatibleRequest(
        modelType: string,
        systemPrompt: string,
        prompt: string,
        base64Image: string
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
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/jpeg;base64,${base64Image}`,
                            },
                        },
                    ],
                },
            ],
            temperature: 0.1,
        };
    }

    private createGeminiRequest(
        systemPrompt: string,
        prompt: string,
        base64Image: string
    ) {
        return {
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            contents: [
                {
                    parts: [
                        {
                            text: prompt,
                        },
                        {
                            inline_data: {
                                data: base64Image,
                                mime_type: "image/jpeg",
                            },
                        },
                    ],
                },
            ],
            generationConfig: {
                temperature: 0.5,
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
            throw new Error(`API error: ${response.statusCode} - ${response.data?.error?.message || 'Unknown error'}`);
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
                    "Authorization": `Bearer ${apiKey}`,
                };
        }
    }

     private getRequestUrl(provider: LLMProvider, apiEndpoint: string, modelType: string, apiKey: string): string {
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
                return responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';

            case LLMProvider.OPENAI:
            case LLMProvider.OTHER:
            default:
                return responseData.choices?.[0]?.message?.content || '';
        }
    }
}
