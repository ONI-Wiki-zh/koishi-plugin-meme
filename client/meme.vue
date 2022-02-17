<template>
  <k-card>
    <el-upload
      class="upload-meme"
      drag
      action="never"
      multiple
      :accept="'.xcf'"
      :http-request="upload"
      :before-remove="(onRemove as any)"
      :file-list="(store.memes || []).map<UploadFile>(name => ({
        name,
        status: 'ready',
        size: 0,
        uid: 0,
        raw: undefined as any
      }))"
      @exceed="message.error($event)"
    >
      <div>
        <k-icon name="arrow-up">
          <upload-filled />
        </k-icon>
        <div class="el-upload__text">
          将模板文件拖到此处或
          <em>点击上传</em>
        </div>
      </div>
    </el-upload>
  </k-card>
</template>

<script lang="ts" setup>
import { message, send, store } from '@koishijs/client';
import { ElUpload } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { UploadFile } from 'element-plus/es/components/upload/src/upload.type';
import 'element-plus/es/components/upload/style/css';
import { } from 'koishi-plugin-meme';

function refresh(): void {
  send('meme/refresh');
}
async function upload(request: { file: File, onError: Function, onProgress: Function, onSuccess: Function }): Promise<void> {
  try {
    console.log(request)
    if (!request.file.name.endsWith('.xcf')) throw new Error('请上传 xcf 文件')
    const dataUri: string = await new Promise((res, rej) => {
      const r = new FileReader()
      r.readAsDataURL(request.file)
      r.onload = () => res(r.result as string);
      r.onerror = error => rej(error);
    })
    request.onProgress(new Event('progress'))
    await send('meme/upload', request.file.name.slice(0, -4), dataUri)
    request.onSuccess(new Event('success'))
  } catch (e) {
    request.onError(e)
    console.error(e)
    if (e instanceof Error) message.error(`上传失败：${e.message || e.name}`)
    else message.error(`上传失败：${e}`)
  }
}
async function onRemove(file: UploadFile, _fileList: UploadFile[]): Promise<boolean> {
  try {
    await send('meme/delete', file.name.slice(0, -4))
  } catch (e) {
    if (e instanceof Error) message.error(`删除失败：${e.message || e.name}`)
    else message.error(`${file.name} 删除失败：${e}`)
    console.error(e)
    throw e
  }
  return true
}
</script>

<style lang="scss">
.upload-meme {
  .el-upload {
    width: 100%;
  }
  .el-upload-dragger {
    margin: 0 auto;

    display: flex;
    justify-content: center;
    flex-direction: column;
  }
}
</style>
