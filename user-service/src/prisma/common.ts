export enum ErrorType {
    Unknown,
    ConstraintViolation
};

export interface Params {
    message: string;
    status?: ErrorType;
    isUserFault: boolean;
}

export class DbError extends Error {
    status: ErrorType;
    isUserFault: boolean;

    constructor(param: Params) {
        super(param.message);
        this.status = param.status ?? ErrorType.Unknown;
        this.isUserFault = param.isUserFault ?? false;
    }
}