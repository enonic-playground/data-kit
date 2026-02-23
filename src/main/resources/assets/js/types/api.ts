export type ApiError = {
    status: number;
    message: string;
    code?: string;
};

export type ApiResponse<T> = {
    data: T;
};

export type PaginatedResponse<T> = {
    data: T[];
    total: number;
    start: number;
    count: number;
};
