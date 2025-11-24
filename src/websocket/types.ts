export interface WebSocketMessage {
    type: string;
    data: unknown;
    id: number;
}

export type CommandHandlerContext = {
    message: WebSocketMessage;
    connectionId: number;
};

export type CommandHandler = (context: CommandHandlerContext) => Promise<void>;
