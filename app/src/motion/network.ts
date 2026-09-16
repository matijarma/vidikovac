// Moved to shared/motion/network.ts (R-TE15): the twin decodes the same
// artefact the app draws from, so the decoder lives where both can import
// it. Re-exported here until D1 retires the last app-side importer.
export * from '../../../shared/motion/network';
