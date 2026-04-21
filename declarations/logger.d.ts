export type LogChannel = 'warnings' | 'map' | 'regulation';
declare class Logger {
    private streams;
    constructor();
    warning(msg: string): void;
    map(msg: string): void;
    regulation(msg: string): void;
    private write;
    private getStream;
    private cleanupOldLogs;
}
export declare const logger: Logger;
export {};
